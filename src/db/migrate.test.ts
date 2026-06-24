import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { runMigrations } from "./migrate";

describe("schema", () => {
  it("creates all core tables", () => {
    const db = makeTestDb();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const t of [
      "schema_migrations", "thesis", "thesis_chunk", "evidence_unit",
      "prep_item", "prep_item_evidence", "generation_run",
      "practice_run", "practice_run_evidence", "review_item",
      "recording", "plan", "plan_day", "ai_call_log", "app_meta",
    ]) {
      expect(names).toContain(t);
    }
    db.close();
  });

  it("records the applied migration version", () => {
    const db = makeTestDb();
    const v = db.prepare("SELECT max(version) v FROM schema_migrations").get() as { v: number };
    expect(v.v).toBe(1);
    db.close();
  });

  it("is idempotent (re-running applies nothing new)", () => {
    const db = makeTestDb();
    // re-run migrations; should not throw or duplicate
    expect(() => runMigrations(db)).not.toThrow();
    const count = db.prepare("SELECT count(*) c FROM schema_migrations").get() as { c: number };
    expect(count.c).toBe(1);
    db.close();
  });

  it("enforces ON DELETE CASCADE from prep_item to prep_item_evidence", () => {
    const db = makeTestDb();
    db.exec(`
      INSERT INTO thesis (id, title, source_kind, is_active) VALUES ('t1','T','md',1);
      INSERT INTO thesis_chunk (id, thesis_id, ord, text, char_count, hash) VALUES ('c1','t1',0,'x',1,'h');
      INSERT INTO evidence_unit (id, thesis_id, chunk_id, char_start, char_end, text, hash) VALUES ('e1','t1','c1',0,1,'x','h');
      INSERT INTO prep_item (id, thesis_id, type, title, status, validation_status, validator_version, source)
        VALUES ('p1','t1','digest','D','needs_review','needs_review','v1','generated');
      INSERT INTO prep_item_evidence (prep_item_id, evidence_unit_id) VALUES ('p1','e1');
    `);
    db.prepare("DELETE FROM prep_item WHERE id='p1'").run();
    const c = db.prepare("SELECT count(*) c FROM prep_item_evidence").get() as { c: number };
    expect(c.c).toBe(0);
    db.close();
  });

  it("blocks deleting evidence still bound (ON DELETE RESTRICT)", () => {
    const db = makeTestDb();
    db.exec(`
      INSERT INTO thesis (id, title, source_kind, is_active) VALUES ('t1','T','md',1);
      INSERT INTO thesis_chunk (id, thesis_id, ord, text, char_count, hash) VALUES ('c1','t1',0,'x',1,'h');
      INSERT INTO evidence_unit (id, thesis_id, chunk_id, char_start, char_end, text, hash) VALUES ('e1','t1','c1',0,1,'x','h');
      INSERT INTO prep_item (id, thesis_id, type, title, status, validation_status, validator_version, source)
        VALUES ('p1','t1','digest','D','needs_review','needs_review','v1','generated');
      INSERT INTO prep_item_evidence (prep_item_id, evidence_unit_id) VALUES ('p1','e1');
    `);
    expect(() => db.prepare("DELETE FROM evidence_unit WHERE id='e1'").run()).toThrow();
    db.close();
  });
});
