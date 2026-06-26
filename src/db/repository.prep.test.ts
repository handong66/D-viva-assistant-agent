import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { createGenerationRun, getThesisEvidence, insertGeneratedPrepItem, finalizeGenerationRun } from "./repository";

function seedThesis(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,text,char_count,hash) VALUES ('c1','t1',0,'accuracy was 81.3%',18,'h');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash) VALUES ('e1','t1','c1',0,18,'accuracy was 81.3%','h');
  `);
}

describe("prep repository", () => {
  it("createGenerationRun + finalizeGenerationRun track status", () => {
    const db = makeTestDb(); seedThesis(db);
    const runId = createGenerationRun(db, "t1", "prep_pack");
    expect((db.prepare("SELECT status FROM generation_run WHERE id=?").get(runId) as { status: string }).status).toBe("running");
    finalizeGenerationRun(db, runId, "done");
    expect((db.prepare("SELECT status FROM generation_run WHERE id=?").get(runId) as { status: string }).status).toBe("done");
    db.close();
  });
  it("getThesisEvidence returns id+text for grounding", () => {
    const db = makeTestDb(); seedThesis(db);
    expect(getThesisEvidence(db, "t1")).toEqual([{ id: "e1", text: "accuracy was 81.3%" }]);
    db.close();
  });
  it("insertGeneratedPrepItem returns the new id and stamps generation_run_id + needs_review", () => {
    const db = makeTestDb(); seedThesis(db);
    const runId = createGenerationRun(db, "t1", "prep_pack");
    const id = insertGeneratedPrepItem(db, { thesisId: "t1", generationRunId: runId, type: "qa", title: "Q", claim_text: "c", evidence_quote: null, value_numeric: null, unit: null });
    const row = db.prepare("SELECT generation_run_id, status, validation_status, source FROM prep_item WHERE id=?").get(id) as { generation_run_id: string; status: string; validation_status: string; source: string };
    expect(row).toMatchObject({ generation_run_id: runId, status: "needs_review", validation_status: "needs_review", source: "generated" });
    db.close();
  });
});
