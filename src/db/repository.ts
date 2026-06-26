import "server-only";
import { randomUUID } from "node:crypto";
import type { Database as DB } from "better-sqlite3";

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
