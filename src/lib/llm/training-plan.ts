import { z } from "zod";
import type { LlmClient } from "./types";
import type { PlanDayInput } from "../../db/repository";

export enum PLAN_ACTIONS {
  READ_SECTION = "READ_SECTION",
  WRITE_ANSWER = "WRITE_ANSWER",
  MOCK_QUESTION = "MOCK_QUESTION",
  REVIEW_NOTES = "REVIEW_NOTES",
  REHEARSE_OUT_LOUD = "REHEARSE_OUT_LOUD",
  SUMMARIZE_SECTION = "SUMMARIZE_SECTION",
  CHECK_EVIDENCE = "CHECK_EVIDENCE",
}

const PLAN_ACTION_VALUES = Object.values(PLAN_ACTIONS) as [PLAN_ACTIONS, ...PLAN_ACTIONS[]];

export const PlanDayGenSchema = z.object({
  theme: z.string().min(1).max(60),
  sectionFocus: z.array(z.string()).max(4),
  actions: z.array(z.enum(PLAN_ACTION_VALUES)).min(1).max(4),
});

export const TrainingPlanSchema = z.object({
  days: z.array(PlanDayGenSchema).min(1),
});

export type GeneratedPlanDay = z.infer<typeof PlanDayGenSchema>;
export type TrainingPlanPromptMessage = { role: "system" | "user"; content: string };

export const ACTION_LABEL: Record<PLAN_ACTIONS, string> = {
  [PLAN_ACTIONS.READ_SECTION]: "Read and annotate the focused thesis section",
  [PLAN_ACTIONS.WRITE_ANSWER]: "Write a concise answer for a likely viva question",
  [PLAN_ACTIONS.MOCK_QUESTION]: "Practice a mock viva question",
  [PLAN_ACTIONS.REVIEW_NOTES]: "Review weak spots and flagged review items",
  [PLAN_ACTIONS.REHEARSE_OUT_LOUD]: "Rehearse answers out loud",
  [PLAN_ACTIONS.SUMMARIZE_SECTION]: "Write a one-page section summary",
  [PLAN_ACTIONS.CHECK_EVIDENCE]: "Check claims against the prep pack",
};

export const THEME_BAD = /["“”«»%]|\d/;

export function buildTrainingPlanPrompt(
  title: string,
  sections: string[],
  totalDays: number,
  progressSummary: string,
): TrainingPlanPromptMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are a viva (thesis defence) coach.",
        "Generate only structured study-schedule choices, not thesis facts, quotations, statistics, or prose claims.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `Build a ${totalDays}-day prep schedule for the thesis "${title}".`,
        `Return exactly ${totalDays} days. For each day output only: theme, sectionFocus, and actions.`,
        `theme must be a few words with no numbers, quotes, percentages, findings, or citations.`,
        `sectionFocus must contain 0-4 names chosen only from the section list below.`,
        `actions must contain 1-4 values chosen only from: ${PLAN_ACTION_VALUES.join(", ")}.`,
        "Sequence an arc across days: early = read and understand; middle = practice and write answers; late = rehearse and review weak spots.",
        "",
        `THESIS SECTIONS: ${sections.length ? sections.join("; ") : "(none - leave sectionFocus empty)"}`,
        `CANDIDATE PROGRESS: ${progressSummary}`,
      ].join("\n"),
    },
  ];
}

export async function generateTrainingPlan(
  client: LlmClient,
  opts: { thesisId?: string; title: string; sections: string[]; totalDays: number; progressSummary: string },
): Promise<GeneratedPlanDay[]> {
  const messages = buildTrainingPlanPrompt(opts.title, opts.sections, opts.totalDays, opts.progressSummary);
  const system = messages.find((message) => message.role === "system")?.content;
  const prompt = messages.filter((message) => message.role === "user").map((message) => message.content).join("\n\n");
  const out = await client.generateObject({
    role: "default",
    purpose: "training_plan",
    schema: TrainingPlanSchema,
    prompt,
    system,
    thesisId: opts.thesisId,
  });
  return out.days;
}

export function renderPlanDay(
  gen: GeneratedPlanDay,
  dayNo: number,
  validSections: ReadonlySet<string>,
): PlanDayInput | null {
  const theme = gen.theme.trim();
  if (!theme || THEME_BAD.test(theme)) return null;

  const sectionFocus = gen.sectionFocus.filter((section) => validSections.has(section));
  return {
    dayNo,
    title: `Day ${dayNo} - ${theme}`,
    focus: sectionFocus.length ? `Focus: ${sectionFocus.join(", ")}` : "General review",
    activities: gen.actions.map((action) => ACTION_LABEL[action]),
  };
}
