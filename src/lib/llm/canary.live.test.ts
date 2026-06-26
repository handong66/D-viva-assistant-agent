import { describe, it, expect } from "vitest";
import { z } from "zod";
import { loadConfig } from "../config";
import { createLlmClient } from "./client";
import { resolveModel } from "./model-registry";

const live = process.env.RUN_LIVE_AI === "1";

describe.skipIf(!live)("LLM canary (live)", () => {
  it("returns a schema-valid object from the configured default model", async () => {
    const { aiSdkTransport } = await import("./transport");
    const client = createLlmClient(aiSdkTransport(), { resolveModel, logCall: () => {} });
    const schema = z.object({ capital: z.string() });
    const out = await client.generateObject({
      role: "default", purpose: "canary", schema,
      prompt: "Return JSON with the capital of France.",
    });
    expect(out.capital.toLowerCase()).toContain("paris");
  }, 30_000);

  it("config reports effectiveAiEnabled when a key is present", () => {
    expect(loadConfig(process.env).effectiveAiEnabled).toBe(true);
  });
});
