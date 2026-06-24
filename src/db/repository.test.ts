import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { replaceActiveThesis, bindPrepEvidence } from "./repository";

describe("replaceActiveThesis", () => {
  it("keeps exactly one active thesis", () => {
    const db = makeTestDb();
    replaceActiveThesis(db, { id: "t1", title: "A", source_kind: "md" });
    replaceActiveThesis(db, { id: "t2", title: "B", source_kind: "md" });
    const active = db.prepare("SELECT id FROM thesis WHERE is_active=1").all() as { id: string }[];
    expect(active).toEqual([{ id: "t2" }]);
    db.close();
  });

  it("keeps the archived thesis row (not deleted)", () => {
    const db = makeTestDb();
    replaceActiveThesis(db, { id: "t1", title: "A", source_kind: "md" });
    replaceActiveThesis(db, { id: "t2", title: "B", source_kind: "md" });
    const all = db.prepare("SELECT count(*) c FROM thesis").get() as { c: number };
    expect(all.c).toBe(2);
    db.close();
  });
});

describe("bindPrepEvidence", () => {
  function seed(db: ReturnType<typeof makeTestDb>) {
    db.exec(`
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','A','md',1);
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t2','B','md',0);
      INSERT INTO thesis_chunk (id,thesis_id,ord,text,char_count,hash) VALUES ('c1','t1',0,'x',1,'h');
      INSERT INTO thesis_chunk (id,thesis_id,ord,text,char_count,hash) VALUES ('c2','t2',0,'y',1,'h');
      INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash) VALUES ('e1','t1','c1',0,1,'x','h');
      INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash) VALUES ('e2','t2','c2',0,1,'y','h');
      INSERT INTO prep_item (id,thesis_id,type,title,status,validation_status,validator_version,source)
        VALUES ('p1','t1','digest','D','needs_review','needs_review','v1','generated');
    `);
  }

  it("binds same-thesis evidence", () => {
    const db = makeTestDb();
    seed(db);
    bindPrepEvidence(db, "p1", ["e1"]);
    const c = db.prepare("SELECT count(*) c FROM prep_item_evidence WHERE prep_item_id='p1'").get() as { c: number };
    expect(c.c).toBe(1);
    db.close();
  });

  it("rejects cross-thesis evidence binding", () => {
    const db = makeTestDb();
    seed(db);
    expect(() => bindPrepEvidence(db, "p1", ["e2"])).toThrow(/same thesis/i);
    db.close();
  });

  it("rolls back the whole binding if any evidence is cross-thesis", () => {
    const db = makeTestDb();
    seed(db);
    // e1 is valid, e2 is cross-thesis; the transaction must roll back both.
    expect(() => bindPrepEvidence(db, "p1", ["e1", "e2"])).toThrow();
    const c = db.prepare("SELECT count(*) c FROM prep_item_evidence WHERE prep_item_id='p1'").get() as { c: number };
    expect(c.c).toBe(0);
    db.close();
  });
});
