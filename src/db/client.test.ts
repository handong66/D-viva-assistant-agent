import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "./client";

const g = globalThis as unknown as {
  __dVivaAssistantAgentDb?: import("better-sqlite3").Database;
  __dVivaAssistantAgentDbPath?: string;
};

afterEach(() => {
  g.__dVivaAssistantAgentDb?.close?.();
  delete g.__dVivaAssistantAgentDb;
  delete g.__dVivaAssistantAgentDbPath;
});

describe("getDb", () => {
  it("fresh :memory: db has schema after getDb()", () => {
    delete g.__dVivaAssistantAgentDb;
    const db = getDb(":memory:");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='thesis'").get()).toEqual({
      name: "thesis",
    });
  });

  it("getDb returns same singleton on repeat calls", () => {
    delete g.__dVivaAssistantAgentDb;
    expect(getDb(":memory:")).toBe(getDb(":memory:"));
  });
});
