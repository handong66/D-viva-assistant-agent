import "server-only";
import { randomUUID } from "node:crypto";
import type { Database as DB } from "better-sqlite3";
import { VALIDATOR_VERSION, type EvidenceText, type Verdict } from "../lib/evidence/validator";

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
  if (!parent) throw new Error(`${parentTable} not found: ${parentId}`);
  const insert = db.prepare(
    `INSERT INTO ${joinTable} (${parentCol}, evidence_unit_id) VALUES (?,?)`,
  );
  const tx = db.transaction(() => {
    for (const eid of evidenceUnitIds) {
      const ev = db.prepare("SELECT thesis_id FROM evidence_unit WHERE id=?").get(eid) as
        | { thesis_id: string }
        | undefined;
      if (!ev) throw new Error(`evidence_unit not found: ${eid}`);
      if (ev.thesis_id !== parent.thesis_id) {
        throw new Error(
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
    validation_status: verdict.validationStatus,
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
