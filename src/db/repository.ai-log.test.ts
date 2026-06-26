import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { logAiCall } from "./repository";

describe("logAiCall", () => {
  it("inserts an ai_call_log row", () => {
    const db = makeTestDb();
    logAiCall(db, { purpose: "judge", provider: "anthropic", model: "anthropic/x", latencyMs: 12, status: "ok" });
    const row = db.prepare("SELECT purpose, provider, model, latency_ms, status FROM ai_call_log").get();
    expect(row).toEqual({ purpose: "judge", provider: "anthropic", model: "anthropic/x", latency_ms: 12, status: "ok" });
    db.close();
  });
});
