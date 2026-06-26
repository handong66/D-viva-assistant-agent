import { describe, it, expect } from "vitest";
import { z } from "zod";
import { MockLlmClient } from "./mock";

describe("MockLlmClient", () => {
  it("returns scripted object responses by purpose and records calls", async () => {
    const mock = new MockLlmClient();
    mock.setObject("judge", { score: 4 });
    const schema = z.object({ score: z.number() });
    const out = await mock.generateObject({ role: "default", purpose: "judge", schema, prompt: "p" });
    expect(out).toEqual({ score: 4 });
    expect(mock.calls).toEqual([{ kind: "object", role: "default", purpose: "judge" }]);
  });

  it("validates scripted object against the provided schema", async () => {
    const mock = new MockLlmClient();
    mock.setObject("judge", { score: "not-a-number" });
    const schema = z.object({ score: z.number() });
    await expect(
      mock.generateObject({ role: "default", purpose: "judge", schema, prompt: "p" }),
    ).rejects.toThrow();
  });

  it("throws if no script is set for a purpose", async () => {
    const mock = new MockLlmClient();
    await expect(mock.generateText({ role: "fast", purpose: "x", prompt: "p" })).rejects.toThrow(/no mock/i);
  });
});
