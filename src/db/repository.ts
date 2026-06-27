import "server-only";
import { randomUUID } from "node:crypto";
import type { Database as DB } from "better-sqlite3";
import { VALIDATOR_VERSION, type EvidenceText, type Verdict, type PrepItemType } from "../lib/evidence/validator";

export class EvidenceBindingError extends Error {
  constructor(message: string) { super(message); this.name = "EvidenceBindingError"; }
}

export type NewThesis = {
  id: string;
  title: string;
  author?: string;
  abstract?: string;
  source_kind: "pdf" | "md" | "txt";
};

/** Archive any current active thesis and insert the given one as the single active thesis. */
export function replaceActiveThesis(db: DB, t: NewThesis): void {
  const tx = db.transaction(() => {
    db.prepare("UPDATE thesis SET is_active=0 WHERE is_active=1").run();
    db.prepare(
      "INSERT INTO thesis (id,title,author,abstract,source_kind,is_active) VALUES (@id,@title,@author,@abstract,@source_kind,1)",
    ).run({ author: null, abstract: null, ...t });
  });
  tx();
}

// Bind evidence units to a parent row (prep_item or practice_run), enforcing the
// same-thesis invariant transactionally. Table/column names are internal constants,
// never user input.
function bindEvidence(
  db: DB,
  parentTable: "prep_item" | "practice_run",
  joinTable: "prep_item_evidence" | "practice_run_evidence",
  parentCol: "prep_item_id" | "practice_run_id",
  parentId: string,
  evidenceUnitIds: string[],
): void {
  const parent = db.prepare(`SELECT thesis_id FROM ${parentTable} WHERE id=?`).get(parentId) as
    | { thesis_id: string }
    | undefined;
  if (!parent) throw new EvidenceBindingError(`${parentTable} not found: ${parentId}`);
  const insert = db.prepare(
    `INSERT INTO ${joinTable} (${parentCol}, evidence_unit_id) VALUES (?,?)`,
  );
  const tx = db.transaction(() => {
    for (const eid of evidenceUnitIds) {
      const ev = db.prepare("SELECT thesis_id FROM evidence_unit WHERE id=?").get(eid) as
        | { thesis_id: string }
        | undefined;
      if (!ev) throw new EvidenceBindingError(`evidence_unit not found: ${eid}`);
      if (ev.thesis_id !== parent.thesis_id) {
        throw new EvidenceBindingError(
          `evidence ${eid} not from the same thesis as ${parentTable} ${parentId}`,
        );
      }
      insert.run(parentId, eid);
    }
  });
  tx();
}

/** Bind evidence units to a prep_item (same-thesis enforced). */
export function bindPrepEvidence(db: DB, prepItemId: string, evidenceUnitIds: string[]): void {
  bindEvidence(db, "prep_item", "prep_item_evidence", "prep_item_id", prepItemId, evidenceUnitIds);
}

/** Bind evidence units to a practice_run question (same-thesis enforced). */
export function bindPracticeRunEvidence(
  db: DB,
  practiceRunId: string,
  evidenceUnitIds: string[],
): void {
  bindEvidence(
    db,
    "practice_run",
    "practice_run_evidence",
    "practice_run_id",
    practiceRunId,
    evidenceUnitIds,
  );
}

export type AiCallLogInput = {
  thesisId?: string;
  purpose: string;
  provider: string;
  model: string;
  latencyMs: number;
  status: "ok" | "error" | "timeout";
  error?: string;
};

export function logAiCall(db: DB, entry: AiCallLogInput): void {
  db.prepare(
    `INSERT INTO ai_call_log (id, thesis_id, purpose, provider, model, latency_ms, status, error)
     VALUES (@id, @thesis_id, @purpose, @provider, @model, @latency_ms, @status, @error)`,
  ).run({
    id: randomUUID(),
    thesis_id: entry.thesisId ?? null,
    purpose: entry.purpose,
    provider: entry.provider,
    model: entry.model,
    latency_ms: entry.latencyMs,
    status: entry.status,
    error: entry.error ?? null,
  });
}

export function getBoundEvidence(db: DB, prepItemId: string): EvidenceText[] {
  return db
    .prepare(
      `SELECT eu.id AS id, eu.text AS text
         FROM prep_item_evidence
         JOIN evidence_unit eu ON eu.id = prep_item_evidence.evidence_unit_id
        WHERE prep_item_evidence.prep_item_id = ?
        ORDER BY eu.id`,
    )
    .all(prepItemId) as EvidenceText[];
}

export function applyValidation(db: DB, prepItemId: string, verdict: Verdict): void {
  const validationStatus: Verdict["validationStatus"] =
    verdict.validationStatus === "passed" &&
    (db.prepare("SELECT count(*) c FROM prep_item_evidence WHERE prep_item_id = ?").get(prepItemId) as { c: number }).c === 0
      ? "needs_review"
      : verdict.validationStatus;

  db.prepare(
    `UPDATE prep_item
        SET status = CASE
              WHEN @validation_status = 'passed' THEN 'verified'
              WHEN @validation_status = 'needs_review' THEN 'needs_review'
              ELSE 'unsafe'
            END,
            validation_status = @validation_status,
            support_kind = @support_kind,
            validator_version = @validator_version,
            verified_at = CASE WHEN @validation_status = 'passed' THEN datetime('now') ELSE NULL END,
            updated_at = datetime('now')
      WHERE id = @id`,
  ).run({
    id: prepItemId,
    validation_status: validationStatus,
    support_kind: verdict.supportKind,
    validator_version: VALIDATOR_VERSION,
  });
}

export type NewChunk = { ord: number; section?: string; text: string; charStart: number; charEnd: number; hash: string };

export function insertThesisWithChunks(
  db: DB,
  input: { thesis: { id: string; title: string; author?: string; abstract?: string; source_kind: "pdf" | "md" | "txt" }; chunks: NewChunk[] },
): void {
  const insThesis = db.prepare(
    "INSERT INTO thesis (id,title,author,abstract,source_kind,is_active) VALUES (@id,@title,@author,@abstract,@source_kind,1)",
  );
  const insChunk = db.prepare(
    "INSERT INTO thesis_chunk (id,thesis_id,section,ord,text,char_count,hash) VALUES (@id,@thesis_id,@section,@ord,@text,@char_count,@hash)",
  );
  const insEvidence = db.prepare(
    "INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES (@id,@thesis_id,@chunk_id,@section,@char_start,@char_end,@text,@hash)",
  );
  const tx = db.transaction(() => {
    db.prepare("UPDATE thesis SET is_active=0 WHERE is_active=1").run();
    insThesis.run({ author: null, abstract: null, ...input.thesis });
    for (const c of input.chunks) {
      const chunkId = randomUUID();
      insChunk.run({
        id: chunkId, thesis_id: input.thesis.id, section: c.section ?? null,
        ord: c.ord, text: c.text, char_count: c.text.length, hash: c.hash,
      });
      insEvidence.run({
        id: randomUUID(), thesis_id: input.thesis.id, chunk_id: chunkId, section: c.section ?? null,
        char_start: c.charStart, char_end: c.charEnd, text: c.text, hash: c.hash,
      });
    }
  });
  tx();
}

export function getThesisChunks(db: DB, thesisId: string): { ord: number; text: string }[] {
  return db.prepare("SELECT ord, text FROM thesis_chunk WHERE thesis_id=? ORDER BY ord").all(thesisId) as { ord: number; text: string }[];
}
export function countEvidence(db: DB, thesisId: string): number {
  return (db.prepare("SELECT count(*) c FROM evidence_unit WHERE thesis_id=?").get(thesisId) as { c: number }).c;
}

export type ActiveThesis = { id: string; title: string; author: string | null; sourceKind: "pdf" | "md" | "txt"; createdAt: string };

export function getActiveThesis(db: DB): ActiveThesis | undefined {
  const row = db
    .prepare("SELECT id, title, author, source_kind, created_at FROM thesis WHERE is_active=1 LIMIT 1")
    .get() as { id: string; title: string; author: string | null; source_kind: "pdf" | "md" | "txt"; created_at: string } | undefined;
  if (!row) return undefined;
  return { id: row.id, title: row.title, author: row.author, sourceKind: row.source_kind, createdAt: row.created_at };
}

export function createGenerationRun(db: DB, thesisId: string, kind: "prep_pack" | "prep_item" | "regenerate"): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO generation_run (id, thesis_id, kind, status) VALUES (?,?,?,'running')",
  ).run(id, thesisId, kind);
  return id;
}

export function finalizeGenerationRun(db: DB, runId: string, status: "done" | "error" | "canceled", error?: string): void {
  db.prepare("UPDATE generation_run SET status=?, error=? WHERE id=?").run(status, error ?? null, runId);
}

export function getThesisEvidence(db: DB, thesisId: string): { id: string; text: string }[] {
  // Thesis reading order: order by chunk ord then char span, not by random UUID.
  return db
    .prepare(
      `SELECT eu.id AS id, eu.text AS text
         FROM evidence_unit eu JOIN thesis_chunk tc ON tc.id = eu.chunk_id
        WHERE eu.thesis_id = ? ORDER BY tc.ord, eu.char_start, eu.id`,
    )
    .all(thesisId) as { id: string; text: string }[];
}

export function insertGeneratedPrepItem(
  db: DB,
  item: { thesisId: string; generationRunId: string; type: string; title: string; claim_text: string | null; evidence_quote: string | null; value_numeric: number | null; unit: string | null },
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO prep_item (id, thesis_id, generation_run_id, type, title, claim_text, evidence_quote, value_numeric, unit,
        status, validation_status, validator_version, source)
     VALUES (@id,@thesis_id,@generation_run_id,@type,@title,@claim_text,@evidence_quote,@value_numeric,@unit,
        'needs_review','needs_review','0','generated')`,
  ).run({
    id, thesis_id: item.thesisId, generation_run_id: item.generationRunId, type: item.type, title: item.title,
    claim_text: item.claim_text, evidence_quote: item.evidence_quote, value_numeric: item.value_numeric, unit: item.unit,
  });
  return id;
}

export type ExamEvidence = { id: string; text: string; section: string | null };

export const PRACTICE_QUESTION_KINDS = ["random", "by_section", "cross_section", "hostile", "boundary", "followup"] as const;

export function getThesisEvidenceWithSection(db: DB, thesisId: string): ExamEvidence[] {
  return db
    .prepare(
      `SELECT eu.id AS id, eu.text AS text, eu.section AS section
         FROM evidence_unit eu JOIN thesis_chunk tc ON tc.id = eu.chunk_id
        WHERE eu.thesis_id = ? ORDER BY tc.ord, eu.char_start, eu.id`,
    )
    .all(thesisId) as ExamEvidence[];
}

/** Evidence bound to a practice_run — NOTE the join table is practice_run_evidence,
 *  distinct from getBoundEvidence() which reads prep_item_evidence. */
export function getPracticeRunBoundEvidence(db: DB, practiceRunId: string): EvidenceText[] {
  return db
    .prepare(
      `SELECT eu.id AS id, eu.text AS text
         FROM practice_run_evidence pre JOIN evidence_unit eu ON eu.id = pre.evidence_unit_id
        WHERE pre.practice_run_id = ? ORDER BY eu.id`,
    )
    .all(practiceRunId) as EvidenceText[];
}

/** Atomically insert a practice_run AND bind its evidence. There is intentionally no
 *  public path that persists an unbound run (every question must cite ≥1 evidence). */
export function insertPracticeRunWithEvidence(
  db: DB,
  input: { thesisId: string; question: string; questionKind: string },
  evidenceUnitIds: string[],
): string {
  if (!(PRACTICE_QUESTION_KINDS as readonly string[]).includes(input.questionKind)) {
    throw new Error(`invalid question_kind: ${input.questionKind}`);
  }
  if (evidenceUnitIds.length === 0) throw new Error("a practice_run must bind at least one evidence_unit");
  const id = randomUUID();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO practice_run (id, thesis_id, question, question_kind, status)
       VALUES (@id, @thesis_id, @question, @question_kind, 'practice')`,
    ).run({ id, thesis_id: input.thesisId, question: input.question, question_kind: input.questionKind });
    bindPracticeRunEvidence(db, id, evidenceUnitIds); // re-enforces same-thesis; throws EvidenceBindingError otherwise
  });
  tx();
  return id;
}

export const REVIEW_DIMENSIONS = ["evidence", "clarity", "completeness", "boundary", "delivery"] as const;
export const REVIEW_SCORE_THRESHOLD = 2;

export function getPracticeRunForJudge(
  db: DB,
  practiceRunId: string,
): { thesisId: string; question: string; answerText: string | null; transcript: string | null } | undefined {
  const row = db
    .prepare("SELECT thesis_id, question, answer_text, transcript FROM practice_run WHERE id=?")
    .get(practiceRunId) as { thesis_id: string; question: string; answer_text: string | null; transcript: string | null } | undefined;
  if (!row) return undefined;
  return { thesisId: row.thesis_id, question: row.question, answerText: row.answer_text, transcript: row.transcript };
}

/** Persist a judge result onto the practice_run AND refresh its review queue, atomically.
 *  Returns the dimensions that were pushed to review (score <= REVIEW_SCORE_THRESHOLD). */
export function applyJudgeResult(
  db: DB,
  input: {
    practiceRunId: string;
    thesisId: string;
    scores: Record<string, number>;
    reasons: Record<string, string>;
    diagnosis: string;
    rewrite: string;
    followUps: string[];
  },
): string[] {
  const reviewed: { dim: string; score: number }[] = [];
  for (const dim of REVIEW_DIMENSIONS) {
    const score = input.scores[dim];
    if (score === undefined) throw new Error(`missing score for dimension: ${dim}`);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new Error(`score for ${dim} must be an integer 1-5, got: ${score}`);
    }
    if (score <= REVIEW_SCORE_THRESHOLD) reviewed.push({ dim, score });
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE practice_run SET scores=@scores, diagnosis=@diagnosis, rewrite=@rewrite, follow_ups=@follow_ups
        WHERE id=@id`,
    ).run({
      id: input.practiceRunId,
      scores: JSON.stringify(input.scores),
      diagnosis: input.diagnosis,
      rewrite: input.rewrite,
      follow_ups: JSON.stringify(input.followUps),
    });
    db.prepare("DELETE FROM review_item WHERE practice_run_id=?").run(input.practiceRunId);
    const ins = db.prepare(
      "INSERT INTO review_item (id, thesis_id, practice_run_id, dimension, score, reason) VALUES (?,?,?,?,?,?)",
    );
    for (const r of reviewed) {
      ins.run(randomUUID(), input.thesisId, input.practiceRunId, r.dim, r.score, input.reasons[r.dim]?.trim() || input.diagnosis);
    }
  });
  tx();
  return reviewed.map((r) => r.dim);
}

export type RunReviewItem = { dimension: string; score: number; reason: string | null };

export function getRunReviewItems(db: DB, practiceRunId: string): RunReviewItem[] {
  return db
    .prepare("SELECT dimension, score, reason FROM review_item WHERE practice_run_id = ? AND score <= ? ORDER BY score ASC, dimension")
    .all(practiceRunId, REVIEW_SCORE_THRESHOLD) as RunReviewItem[];
}

export type PrepItemRow = {
  id: string;
  type: string;
  title: string;
  claimText: string | null;
  status: string;
  validationStatus: string;
  supportKind: string | null;
  supportValue: string | null;
};

export function getPrepItems(db: DB, thesisId: string): PrepItemRow[] {
  // Show only the latest successful prep-pack run: de-dups re-generates and hides
  // partial items left behind by a run that finalized 'error'.
  const rows = db
    .prepare(
      `SELECT id, type, title, claim_text, status, validation_status, support_kind, evidence_quote, value_numeric, unit
         FROM prep_item
        WHERE thesis_id = ?
          AND generation_run_id = (
            SELECT id FROM generation_run
             WHERE thesis_id = ? AND kind = 'prep_pack' AND status = 'done'
             ORDER BY created_at DESC, rowid DESC LIMIT 1
          )
        ORDER BY type, created_at, id`,
    )
    .all(thesisId, thesisId) as {
      id: string;
      type: string;
      title: string;
      claim_text: string | null;
      status: string;
      validation_status: string;
      support_kind: string | null;
      evidence_quote: string | null;
      value_numeric: number | null;
      unit: string | null;
    }[];
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    claimText: r.claim_text,
    status: r.status,
    validationStatus: r.validation_status,
    supportKind: r.support_kind,
    supportValue: supportValueForPrepItem(r.support_kind, r.evidence_quote, r.value_numeric, r.unit),
  }));
}

function supportValueForPrepItem(
  supportKind: string | null,
  evidenceQuote: string | null,
  valueNumeric: number | null,
  unit: string | null,
): string | null {
  if (supportKind === "exact_quote") return evidenceQuote;
  if (supportKind === "numeric" && valueNumeric !== null) {
    if (!unit) return String(valueNumeric);
    return unit === "%" ? `${valueNumeric}%` : `${valueNumeric} ${unit}`;
  }
  return null;
}

export type PrepItemForEdit = { id: string; thesisId: string; type: PrepItemType; title: string; claimText: string | null; evidenceQuote: string | null; valueNumeric: number | null; unit: string | null; status: string };

export function getPrepItemForEdit(db: DB, prepItemId: string): PrepItemForEdit | undefined {
  const r = db
    .prepare("SELECT id, thesis_id, type, title, claim_text, evidence_quote, value_numeric, unit, status FROM prep_item WHERE id = ?")
    .get(prepItemId) as { id: string; thesis_id: string; type: PrepItemType; title: string; claim_text: string | null; evidence_quote: string | null; value_numeric: number | null; unit: string | null; status: string } | undefined;
  return r && { id: r.id, thesisId: r.thesis_id, type: r.type, title: r.title, claimText: r.claim_text, evidenceQuote: r.evidence_quote, valueNumeric: r.value_numeric, unit: r.unit, status: r.status };
}

export function updatePrepItemFields(db: DB, prepItemId: string, edits: { claimText: string | null; evidenceQuote: string | null; valueNumeric: number | null; unit: string | null }): void {
  db.prepare(
    `UPDATE prep_item SET claim_text=@claim_text, evidence_quote=@evidence_quote, value_numeric=@value_numeric, unit=@unit, source='edited', updated_at=datetime('now') WHERE id=@id`,
  ).run({ id: prepItemId, claim_text: edits.claimText, evidence_quote: edits.evidenceQuote, value_numeric: edits.valueNumeric, unit: edits.unit });
}

export type PracticeRunView = {
  id: string; question: string; questionKind: string;
  answerText: string | null; transcript: string | null;
  scores: Record<string, number> | null; diagnosis: string | null; rewrite: string | null; followUps: string[] | null;
  status: string;
};

export function getLatestPracticeRun(db: DB, thesisId: string): PracticeRunView | undefined {
  const row = db
    .prepare(
      `SELECT id, question, question_kind, answer_text, transcript, scores, diagnosis, rewrite, follow_ups, status
         FROM practice_run WHERE thesis_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(thesisId) as
    | { id: string; question: string; question_kind: string; answer_text: string | null; transcript: string | null; scores: string | null; diagnosis: string | null; rewrite: string | null; follow_ups: string | null; status: string }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id, question: row.question, questionKind: row.question_kind,
    answerText: row.answer_text, transcript: row.transcript,
    scores: row.scores ? (JSON.parse(row.scores) as Record<string, number>) : null,
    diagnosis: row.diagnosis, rewrite: row.rewrite,
    followUps: row.follow_ups ? (JSON.parse(row.follow_ups) as string[]) : null,
    status: row.status,
  };
}

export type ReviewItemView = { id: string; dimension: string; score: number; reason: string | null; question: string; practiceRunId: string };

export function getReviewItems(db: DB, thesisId: string): ReviewItemView[] {
  const rows = db
    .prepare(
      `SELECT ri.id, ri.dimension, ri.score, ri.reason, ri.practice_run_id, pr.question
         FROM review_item ri JOIN practice_run pr ON pr.id = ri.practice_run_id AND pr.thesis_id = ri.thesis_id
        WHERE ri.thesis_id = ? AND ri.status = 'open' AND ri.score <= 2
        ORDER BY ri.score ASC, ri.created_at DESC, ri.id`,
    )
    .all(thesisId) as { id: string; dimension: string; score: number; reason: string | null; practice_run_id: string; question: string }[];
  return rows.map((r) => ({ id: r.id, dimension: r.dimension, score: r.score, reason: r.reason, question: r.question, practiceRunId: r.practice_run_id }));
}

export function saveAnswer(db: DB, practiceRunId: string, answerText: string): void {
  db.prepare("UPDATE practice_run SET answer_text = ? WHERE id = ?").run(answerText.trim(), practiceRunId);
}

export type ThesisStats = {
  evidenceUnits: number;
  prepTotal: number; prepVerified: number; prepNeedsReview: number; prepUnsafe: number; prepDraft: number;
  practiceRuns: number; openReviews: number;
};

export function getThesisStats(db: DB, thesisId: string): ThesisStats {
  const latestRunId =
    (
      db
        .prepare(
          "SELECT id FROM generation_run WHERE thesis_id = ? AND kind = 'prep_pack' AND status = 'done' ORDER BY created_at DESC, rowid DESC LIMIT 1",
        )
        .get(thesisId) as { id: string } | undefined
    )?.id ?? null;
  const prepCount = (status: string) =>
    latestRunId === null
      ? 0
      : (db.prepare("SELECT count(*) c FROM prep_item WHERE thesis_id = ? AND generation_run_id = ? AND status = ?").get(thesisId, latestRunId, status) as { c: number }).c;
  return {
    evidenceUnits: (db.prepare("SELECT count(*) c FROM evidence_unit WHERE thesis_id = ?").get(thesisId) as { c: number }).c,
    prepTotal:
      latestRunId === null
        ? 0
        : (db.prepare("SELECT count(*) c FROM prep_item WHERE thesis_id = ? AND generation_run_id = ?").get(thesisId, latestRunId) as { c: number }).c,
    prepVerified: prepCount("verified"),
    prepNeedsReview: prepCount("needs_review"),
    prepUnsafe: prepCount("unsafe"),
    prepDraft: prepCount("draft"),
    practiceRuns: (db.prepare("SELECT count(*) c FROM practice_run WHERE thesis_id = ?").get(thesisId) as { c: number }).c,
    openReviews: (db.prepare("SELECT count(*) c FROM review_item WHERE thesis_id = ? AND status = 'open'").get(thesisId) as { c: number }).c,
  };
}

export type NewRecording = {
  id: string;
  thesisId: string;
  practiceRunId?: string;
  mimeType: string;
  languageMode: "english" | "chinese";
  durationMs?: number;
  audioPath?: string;
  sttProvider?: string;
};

export async function insertRecording(db: DB, rec: NewRecording): Promise<void> {
  if (rec.practiceRunId) {
    const run = db
      .prepare("SELECT 1 FROM practice_run WHERE id=? AND thesis_id=?")
      .get(rec.practiceRunId, rec.thesisId);
    if (!run) throw new Error("practice_run not found");
  }

  db.prepare(
    `INSERT INTO recording (id, thesis_id, practice_run_id, path, mime, duration_ms, language_mode, stt_provider)
     VALUES (@id, @thesis_id, @practice_run_id, @path, @mime, @duration_ms, @language_mode, @stt_provider)`,
  ).run({
    id: rec.id,
    thesis_id: rec.thesisId,
    practice_run_id: rec.practiceRunId ?? null,
    path: rec.audioPath ?? "",
    mime: rec.mimeType,
    duration_ms: rec.durationMs ?? null,
    language_mode: rec.languageMode,
    stt_provider: rec.sttProvider ?? null,
  });
}

export async function setRecordingTranscript(
  db: DB,
  recordingId: string,
  transcript: string,
): Promise<void> {
  const trimmed = transcript.trim();
  const tx = db.transaction(() => {
    db.prepare("UPDATE recording SET transcript=?, stt_status='ok', stt_error=NULL WHERE id=?").run(
      trimmed,
      recordingId,
    );
    const row = db
      .prepare("SELECT practice_run_id FROM recording WHERE id=?")
      .get(recordingId) as { practice_run_id: string | null } | undefined;
    if (row?.practice_run_id) {
      db.prepare("UPDATE practice_run SET transcript=? WHERE id=?").run(trimmed, row.practice_run_id);
    }
  });
  tx();
}

export async function setRecordingError(
  db: DB,
  recordingId: string,
  message: string,
): Promise<void> {
  db.prepare("UPDATE recording SET stt_status='error', stt_error=? WHERE id=?").run(message, recordingId);
}

export type ThesisListItem = {
  id: string;
  title: string;
  author: string | null;
  source_kind: string;
  created_at: string;
  is_active: boolean;
};

export function listTheses(db: DB): ThesisListItem[] {
  const rows = db
    .prepare("SELECT id, title, author, source_kind, created_at, is_active FROM thesis ORDER BY created_at DESC, rowid DESC")
    .all() as {
      id: string;
      title: string;
      author: string | null;
      source_kind: string;
      created_at: string;
      is_active: number;
    }[];
  return rows.map((row) => ({ ...row, is_active: !!row.is_active }));
}

export function switchActiveThesis(db: DB, thesisId: string): void {
  const exists = db.prepare("SELECT 1 FROM thesis WHERE id = ?").get(thesisId);
  if (!exists) throw new Error(`Thesis not found: ${thesisId}`);
  db.transaction(() => {
    db.prepare("UPDATE thesis SET is_active = 0 WHERE is_active = 1").run();
    db.prepare("UPDATE thesis SET is_active = 1 WHERE id = ?").run(thesisId);
  })();
}
