import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";

function seedEvidence(db: ReturnType<typeof makeTestDb>, text: string, charEnd: number) {
  db.exec(`
    INSERT INTO thesis (id, title, source_kind, is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id, thesis_id, ord, text, char_count, hash) VALUES ('c1','t1',0,'x',1,'h');
    INSERT INTO evidence_unit (id, thesis_id, chunk_id, char_start, char_end, text, hash)
      VALUES ('e1','t1','c1',0,${charEnd},'${text}','h');
  `);
}

describe("evidence_fts", () => {
  it("FTS5 is available and syncs on insert", () => {
    const db = makeTestDb();
    seedEvidence(db, "emotional prosody study", 23);
    const hit = db
      .prepare("SELECT evidence_unit_id FROM evidence_fts WHERE evidence_fts MATCH ?")
      .get("prosody") as { evidence_unit_id: string } | undefined;
    expect(hit?.evidence_unit_id).toBe("e1");
    db.close();
  });

  it("removes from index on evidence delete", () => {
    const db = makeTestDb();
    seedEvidence(db, "hello", 5);
    db.prepare("DELETE FROM evidence_unit WHERE id='e1'").run();
    const c = db
      .prepare("SELECT count(*) c FROM evidence_fts WHERE evidence_fts MATCH 'hello'")
      .get() as { c: number };
    expect(c.c).toBe(0);
    db.close();
  });

  it("reflects text updates", () => {
    const db = makeTestDb();
    seedEvidence(db, "alpha", 5);
    db.prepare("UPDATE evidence_unit SET text='beta' WHERE id='e1'").run();
    const oldHit = db.prepare("SELECT count(*) c FROM evidence_fts WHERE evidence_fts MATCH 'alpha'").get() as { c: number };
    const newHit = db.prepare("SELECT count(*) c FROM evidence_fts WHERE evidence_fts MATCH 'beta'").get() as { c: number };
    expect(oldHit.c).toBe(0);
    expect(newHit.c).toBe(1);
    db.close();
  });
});
