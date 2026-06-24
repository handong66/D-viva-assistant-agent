import { describe, it, expect } from "vitest";
import { createDb } from "./client";

describe("createDb", () => {
  it("opens an in-memory db with foreign_keys ON", () => {
    const db = createDb(":memory:");
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.prepare("INSERT INTO t (id) VALUES (?)").run(1);
    expect(db.prepare("SELECT count(*) c FROM t").get()).toEqual({ c: 1 });
    db.close();
  });
});
