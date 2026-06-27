import "server-only";
import type { Database as DB } from "better-sqlite3";
import type { LlmClient } from "./types";
import { judgeAnswer, type JudgeScores } from "./judge";
import { getPracticeRunForJudge, getPracticeRunBoundEvidence, applyJudgeResult } from "../../db/repository";

export async function runJudge(
  db: DB,
  client: LlmClient,
  practiceRunId: string,
): Promise<{ scores: JudgeScores; reviewDimensions: string[] }> {
  const run = getPracticeRunForJudge(db, practiceRunId);
  if (!run) throw new Error(`practice_run not found: ${practiceRunId}`);

  const answer = (run.answerText ?? "").trim() || (run.transcript ?? "").trim();
  if (!answer) throw new Error("practice_run has no answer (or transcript) to judge");

  const evidence = getPracticeRunBoundEvidence(db, practiceRunId);
  if (evidence.length === 0) throw new Error("practice_run has no bound evidence to judge against");

  const result = await judgeAnswer(client, { thesisId: run.thesisId, question: run.question, evidence, answer });

  const reviewDimensions = applyJudgeResult(db, {
    practiceRunId,
    thesisId: run.thesisId,
    scores: result.scores,
    reasons: result.reasons,
    diagnosis: result.diagnosis,
    rewrite: result.rewrite,
    followUps: result.follow_ups,
  });

  return { scores: result.scores, reviewDimensions };
}
