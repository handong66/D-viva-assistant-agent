import "server-only";
import type { Database as DB } from "better-sqlite3";
import type { LlmClient } from "./types";
import { type QuestionKind, type EvidenceCandidate, selectCandidates, generateExamQuestion } from "./examiner";
import {
  getThesisEvidenceWithSection,
  getPracticeRunBoundEvidence,
  insertPracticeRunWithEvidence,
} from "../../db/repository";

export async function runExaminerQuestion(
  db: DB,
  client: LlmClient,
  thesisId: string,
  kind: QuestionKind,
  opts?: { section?: string | null; previousRunId?: string },
): Promise<{ practiceRunId: string; question: string; evidenceUnitIds: string[] }> {
  const thesis = db.prepare("SELECT title FROM thesis WHERE id=?").get(thesisId) as { title: string } | undefined;
  if (!thesis) throw new Error(`thesis not found: ${thesisId}`);

  let candidates: EvidenceCandidate[];
  let previous: { question: string; answer: string } | null = null;

  if (kind === "followup") {
    if (!opts?.previousRunId) throw new Error("followup requires opts.previousRunId");
    const prev = db
      .prepare("SELECT question, answer_text, transcript FROM practice_run WHERE id=? AND thesis_id=?")
      .get(opts.previousRunId, thesisId) as { question: string; answer_text: string | null; transcript: string | null } | undefined;
    if (!prev) throw new Error(`previous run not found for this thesis: ${opts.previousRunId}`);
    const answer = (prev.answer_text ?? "").trim() || (prev.transcript ?? "").trim();
    if (!answer) throw new Error("previous run has no answer (or transcript) to follow up on");
    candidates = getPracticeRunBoundEvidence(db, opts.previousRunId).map((e) => ({ id: e.id, text: e.text, section: null }));
    previous = { question: prev.question, answer };
  } else {
    candidates = selectCandidates(getThesisEvidenceWithSection(db, thesisId), kind, opts);
  }
  if (candidates.length === 0) throw new Error(`no candidate evidence for kind=${kind}`);

  const q = await generateExamQuestion(client, { thesisId, title: thesis.title, kind, candidates, previous });

  // Anti-hallucination: keep only ids that were actually offered (dedup, preserve order).
  const offered = new Set(candidates.map((c) => c.id));
  const evidenceUnitIds = Array.from(new Set(q.evidence_unit_ids)).filter((id) => offered.has(id));
  if (evidenceUnitIds.length === 0) throw new Error("examiner cited no provided evidence");

  // Atomic insert+bind (no orphan practice_run) lives in the repository helper.
  const practiceRunId = insertPracticeRunWithEvidence(db, { thesisId, question: q.question, questionKind: kind }, evidenceUnitIds);

  return { practiceRunId, question: q.question, evidenceUnitIds };
}
