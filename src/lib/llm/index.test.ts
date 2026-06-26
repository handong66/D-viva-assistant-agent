import { describe, it, expect } from "vitest";
import { z } from "zod";
import { makeTestDb } from "../../test/db";
import { getLlmClient } from "./index";
import { MockLlmClient } from "./mock";

describe("getLlmClient", () => {
  it("is a disabled client (throws) when effectiveAiEnabled is false", async () => {
    const db = makeTestDb();
    const client = await getLlmClient(db, { effectiveAiEnabled: false, gatewayConfigured: true });
    expect(client.enabled).toBe(false);
    await expect(
      client.generateObject({ role: "default", purpose: "p", schema: z.object({}), prompt: "x" }),
    ).rejects.toThrow(/disabled/i);
    db.close();
  });

  it("is disabled when AI is enabled but the gateway is not configured", async () => {
    const db = makeTestDb();
    const client = await getLlmClient(db, { effectiveAiEnabled: true, gatewayConfigured: false });
    expect(client.enabled).toBe(false);
    db.close();
  });

  it("uses an injected client when provided (test seam)", async () => {
    const db = makeTestDb();
    const mock = new MockLlmClient().setText("p", "hi");
    const client = await getLlmClient(db, { effectiveAiEnabled: true, gatewayConfigured: true, override: mock });
    expect(await client.generateText({ role: "fast", purpose: "p", prompt: "x" })).toBe("hi");
    db.close();
  });
});
