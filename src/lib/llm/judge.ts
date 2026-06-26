import { z } from "zod";
import type { LlmClient } from "./types";

export const DIMENSIONS = ["evidence", "clarity", "completeness", "boundary", "delivery"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

const scoreSchema = z.number().int().min(1).max(5);
export const JudgeScoresSchema = z.object({
  evidence: scoreSchema,
  clarity: scoreSchema,
  completeness: scoreSchema,
  boundary: scoreSchema,
  delivery: scoreSchema,
});
export const JudgeResultSchema = z.object({
  scores: JudgeScoresSchema,
  diagnosis: z.string().min(1),
  rewrite: z.string().min(1),
  follow_ups: z.array(z.string()),
});
export type JudgeScores = z.infer<typeof JudgeScoresSchema>;
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

export function buildJudgePrompt(args: {
  question: string;
  evidence: { id: string; text: string }[];
  answer: string;
}): string {
  const evidenceLines = args.evidence.map((item) => `[${item.id}] ${item.text}`).join("\n");

  return [
    "You are a viva (thesis defence) examiner scoring a candidate's spoken/written answer.",
    'Judge ONLY against the EVIDENCE below. Do not use outside knowledge. If the answer asserts something not supported by this evidence, the "evidence" score must be low.',
    "Score each dimension as an integer 1-5 (1 worst, 5 best):",
    "- evidence: how well the answer is supported by and consistent with the provided evidence",
    "- clarity: how clear and well-structured the answer is",
    "- completeness: how fully it addresses the question",
    "- boundary: awareness of scope, assumptions, and limitations",
    "- delivery: quality of English expression",
    "Also return: a brief diagnosis, an improved English rewrite of the answer grounded in the evidence, and 0-3 follow-up questions.",
    "",
    `QUESTION: ${args.question}`,
    "",
    "EVIDENCE (id: text):",
    evidenceLines,
    "",
    `CANDIDATE ANSWER: ${args.answer}`,
  ].join("\n");
}

export async function judgeAnswer(
  client: LlmClient,
  args: {
    thesisId: string;
    question: string;
    evidence: { id: string; text: string }[];
    answer: string;
  },
): Promise<JudgeResult> {
  return client.generateObject({
    role: "hard",
    purpose: "judge",
    schema: JudgeResultSchema,
    prompt: buildJudgePrompt(args),
    thesisId: args.thesisId,
  });
}
