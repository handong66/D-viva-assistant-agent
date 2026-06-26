import { describe, expect, it } from "vitest";
import { makeTestDb } from "../test/db";
import { getActiveThesis } from "./repository";

describe("getActiveThesis", () => {
  it("returns undefined when no active thesis exists", () => {
    const db = makeTestDb();
    expect(getActiveThesis(db)).toBeUndefined();
    db.close();
  });

  it("returns mapped ActiveThesis when one exists", () => {
    const db = makeTestDb();
    db.exec(`
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('old','Old','pdf',0);
      INSERT INTO thesis (id,title,author,source_kind,is_active) VALUES ('active','Active','Jane Doe','md',1);
    `);
    expect(getActiveThesis(db)).toMatchObject({
      id: "active",
      title: "Active",
      author: "Jane Doe",
      sourceKind: "md",
    });
    expect(getActiveThesis(db)?.createdAt).toEqual(expect.any(String));
    db.close();
  });
});
