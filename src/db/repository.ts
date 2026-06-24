import "server-only";
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

/** Bind evidence units to a prep_item, enforcing the same-thesis invariant. */
export function bindPrepEvidence(db: DB, prepItemId: string, evidenceUnitIds: string[]): void {
  const prep = db.prepare("SELECT thesis_id FROM prep_item WHERE id=?").get(prepItemId) as
    | { thesis_id: string }
    | undefined;
  if (!prep) throw new Error(`prep_item not found: ${prepItemId}`);
  const insert = db.prepare(
    "INSERT INTO prep_item_evidence (prep_item_id, evidence_unit_id) VALUES (?,?)",
  );
  const tx = db.transaction(() => {
    for (const eid of evidenceUnitIds) {
      const ev = db.prepare("SELECT thesis_id FROM evidence_unit WHERE id=?").get(eid) as
        | { thesis_id: string }
        | undefined;
      if (!ev) throw new Error(`evidence_unit not found: ${eid}`);
      if (ev.thesis_id !== prep.thesis_id) {
        throw new Error(
          `evidence ${eid} not from the same thesis as prep_item ${prepItemId}`,
        );
      }
      insert.run(prepItemId, eid);
    }
  });
  tx();
}
