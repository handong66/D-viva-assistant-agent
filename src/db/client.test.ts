import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "./client";

const g = globalThis as unknown as { __vivaDb?: import("better-sqlite3").Database };

afterEach(() => {
  g.__vivaDb?.close?.();
  delete g.__vivaDb;
});

describe("getDb", () => {
  it("fresh :memory: db has schema after getDb()", () => {
    delete g.__vivaDb;
    const db = getDb(":memory:");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='thesis'").get()).toEqual({
      name: "thesis",
    });
  });

  it("getDb returns same singleton on repeat calls", () => {
    delete g.__vivaDb;
    expect(getDb(":memory:")).toBe(getDb(":memory:"));
  });
});
