"use server";
import { revalidatePath } from "next/cache";
import { appContext, appLlmClient } from "../../lib/server/context";
import { getActiveThesis, saveAnswer } from "../../db/repository";
import { runExaminerQuestion } from "../../lib/llm/examiner-run";
import { runJudge } from "../../lib/llm/judge-run";
import { type QuestionKind } from "../../lib/llm/examiner";

export type PracticeState = { error: string | null };

const AI_OFF = "AI is disabled. Set AI_GATEWAY_API_KEY and VIVA_AI_ENABLED=true to practice with the AI examiner.";
// v1 selectable kinds (no extra input): random, cross_section, hostile, boundary.
const SELECTABLE: ReadonlySet<string> = new Set(["random", "cross_section", "hostile", "boundary"]);

export async function startPracticeAction(_prev: PracticeState, formData: FormData): Promise<PracticeState> {
  const { db, config } = await appContext();
  const thesis = getActiveThesis(db);
  if (!thesis) return { error: "Import a thesis first." };

  const kind = String(formData.get("kind") ?? "");
  const topic = String(formData.get("topic") ?? "").trim();
  if (!SELECTABLE.has(kind)) return { error: "Pick a question type." };
  if (!config.effectiveAiEnabled || !config.gatewayConfigured) return { error: AI_OFF };

  try {
    const client = await appLlmClient({ db, config });
    await runExaminerQuestion(db, client, thesis.id, kind as QuestionKind, topic ? { topic } : undefined);
    revalidatePath("/practice");
    return { error: null };
  } catch (error) {
    console.error("[startPracticeAction]", error);
    return { error: "Could not generate a question. Please try again." };
  }
}

export async function submitAnswerAction(_prev: PracticeState, formData: FormData): Promise<PracticeState> {
  const { db, config } = await appContext();
  const thesis = getActiveThesis(db);
  if (!thesis) return { error: "Import a thesis first." };

  const answer = String(formData.get("answer") ?? "").trim();
  if (!answer) return { error: "Type an answer first." };

  // Judge the SPECIFIC question the user was shown (carried in the form), cross-checked to
  // the active thesis - so generating another question elsewhere can't misbind the answer,
  // and a tampered/cross-thesis id is rejected.
  const runId = String(formData.get("practiceRunId") ?? "");
  const owned = db.prepare("SELECT id FROM practice_run WHERE id = ? AND thesis_id = ?").get(runId, thesis.id) as { id: string } | undefined;
  if (!owned) return { error: "That question is no longer available. Generate a new one." };
  if (!config.effectiveAiEnabled || !config.gatewayConfigured) return { error: AI_OFF };

  try {
    saveAnswer(db, owned.id, answer);
    const client = await appLlmClient({ db, config });
    await runJudge(db, client, owned.id);
    revalidatePath("/practice");
    revalidatePath("/review");
    return { error: null };
  } catch (error) {
    console.error("[submitAnswerAction]", error);
    return { error: "Could not score your answer. Please try again." };
  }
}
