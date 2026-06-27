import "server-only";
import type { Database as DB } from "better-sqlite3";
import type { LlmClient } from "./types";
import { ACTION_LABEL, generateTrainingPlan, PLAN_ACTIONS, renderPlanDay } from "./training-plan";
import {
  getActiveThesis,
  getReviewItems,
  getThesisSections,
  getThesisStats,
  savePlan,
  type PlanDayInput,
} from "../../db/repository";
import { staticPlanDays } from "../plan";

export type TrainingPlanGenerationSource = { source: "ai" | "static" };

export async function runTrainingPlanGeneration({
  db,
  llmClient,
  totalDays,
  thesisId,
}: {
  db: DB;
  llmClient: LlmClient;
  totalDays: number;
  thesisId?: string;
}): Promise<TrainingPlanGenerationSource> {
  const thesis = thesisId
    ? (db.prepare("SELECT id, title FROM thesis WHERE id = ?").get(thesisId) as { id: string; title: string } | undefined)
    : getActiveThesis(db);
  if (!thesis) throw new Error("No active thesis found");

  const sections = getThesisSections(db, thesis.id);
  const stats = getThesisStats(db, thesis.id);
  const weakDimensions = Array.from(new Set(getReviewItems(db, thesis.id).map((item) => item.dimension)));
  const progressSummary = [
    `${stats.prepVerified} verified prep items`,
    `${stats.prepNeedsReview} prep items need review`,
    `${stats.openReviews} open review spots`,
    weakDimensions.length ? `weakest dimensions: ${weakDimensions.join(", ")}` : "",
  ].filter(Boolean).join("; ");

  const generated = await generateTrainingPlan(llmClient, {
    thesisId: thesis.id,
    title: thesis.title,
    sections,
    totalDays,
    progressSummary,
  });
  const validSections = new Set(sections);
  const rendered = generated.map((day, index) => renderPlanDay(day, index + 1, validSections));

  const saveStatic = () => {
    savePlan(db, {
      thesisId: thesis.id,
      name: `${totalDays}-day plan`,
      totalDays,
      templateKey: "static",
      days: staticPlanDays(totalDays),
    });
  };

  if (rendered.some((day) => day === null)) {
    saveStatic();
    return { source: "static" };
  }

  const days = normalizeToNDays(rendered as PlanDayInput[], totalDays);
  savePlan(db, {
    thesisId: thesis.id,
    name: `${totalDays}-day plan`,
    totalDays,
    templateKey: "ai",
    days,
  });
  return { source: "ai" };
}

function normalizeToNDays(days: PlanDayInput[], totalDays: number): PlanDayInput[] {
  const normalized = days.slice(0, totalDays).map((day, index) => ({ ...day, dayNo: index + 1 }));
  while (normalized.length < totalDays) {
    const dayNo = normalized.length + 1;
    normalized.push({
      dayNo,
      title: `Day ${dayNo} - Review & rehearse`,
      focus: "General review",
      activities: [
        ACTION_LABEL[PLAN_ACTIONS.REVIEW_NOTES],
        ACTION_LABEL[PLAN_ACTIONS.REHEARSE_OUT_LOUD],
      ],
    });
  }
  return normalized;
}
