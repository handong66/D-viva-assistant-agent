import { describe, expect, it } from "vitest";
import { makeTestDb } from "../test/db";
import { listTheses, switchActiveThesis } from "./repository";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,author,source_kind,is_active,created_at) VALUES ('t0','Old','A','pdf',0,'2026-06-01T00:00:00Z');
    INSERT INTO thesis (id,title,author,source_kind,is_active,created_at) VALUES ('t1','Current','B','md',1,'2026-06-02T00:00:00Z');
    INSERT INTO thesis (id,title,author,source_kind,is_active,created_at) VALUES ('t2','Newest',NULL,'txt',0,'2026-06-03T00:00:00Z');
  `);
}

describe("thesis list + switch", () => {
  it("listTheses returns newest-first and active flag correct", () => {
    const db = makeTestDb();
    seed(db);

    const theses = listTheses(db);

    expect(theses.map((thesis) => thesis.id)).toEqual(["t2", "t1", "t0"]);
    expect(theses.find((thesis) => thesis.id === "t1")).toMatchObject({
      title: "Current",
      author: "B",
      source_kind: "md",
      created_at: "2026-06-02T00:00:00Z",
      is_active: true,
    });
    expect(theses.find((thesis) => thesis.id === "t0")?.is_active).toBe(false);
    db.close();
  });

  it("switchActiveThesis flips active + single-active preserved", () => {
    const db = makeTestDb();
    seed(db);

    switchActiveThesis(db, "t0");

    expect((db.prepare("SELECT id FROM thesis WHERE is_active = 1").get() as { id: string }).id).toBe("t0");
    expect((db.prepare("SELECT count(*) c FROM thesis WHERE is_active = 1").get() as { c: number }).c).toBe(1);
    db.close();
  });

  it("switchActiveThesis throws on unknown id without mutating DB", () => {
    const db = makeTestDb();
    seed(db);
    const before = db.prepare("SELECT id, is_active FROM thesis ORDER BY id").all();

    expect(() => switchActiveThesis(db, "unknown")).toThrow("Thesis not found: unknown");

    expect(db.prepare("SELECT id, is_active FROM thesis ORDER BY id").all()).toEqual(before);
    db.close();
  });
});
