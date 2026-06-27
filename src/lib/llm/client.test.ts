import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createLlmClient } from "./client";
import type { LlmTransport } from "./types";

function fakeTransport(over: Partial<LlmTransport> = {}): LlmTransport {
  return {
    object: async () => ({ ok: true }),
    text: async () => "hello",
    ...over,
  };
}

describe("createLlmClient", () => {
  it("resolves the model by role and returns a schema-validated object", async () => {
    const seen: string[] = [];
    const client = createLlmClient(
      fakeTransport({ object: async (model) => { seen.push(model); return { ok: true }; } }),
      { resolveModel: (role) => `m-${role}`, logCall: () => {} },
    );
    const out = await client.generateObject({
      role: "hard", purpose: "judge", schema: z.object({ ok: z.boolean() }), prompt: "p",
    });
    expect(out).toEqual({ ok: true });
    expect(seen).toEqual(["m-hard"]);
  });

  it("logs every call (provider, model, status, latency)", async () => {
    const logCall = vi.fn();
    const client = createLlmClient(fakeTransport(), { resolveModel: () => "anthropic/x", logCall });
    await client.generateText({ role: "fast", purpose: "p", prompt: "hi" });
    expect(logCall).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "p", provider: "anthropic", model: "anthropic/x", status: "ok" }),
    );
  });

  it("normalizes transport errors and logs status=error", async () => {
    const logCall = vi.fn();
    const client = createLlmClient(
      fakeTransport({ text: async () => { throw new Error("boom"); } }),
      { resolveModel: () => "openai/x", logCall },
    );
    await expect(client.generateText({ role: "fast", purpose: "p", prompt: "hi" })).rejects.toThrow(/boom/);
    expect(logCall).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
  });

  it("times out a slow call and logs status=timeout", async () => {
    const logCall = vi.fn();
    const client = createLlmClient(
      fakeTransport({ text: () => new Promise<string>(() => {}) }), // never resolves
      { resolveModel: () => "anthropic/x", logCall, timeoutMs: 10 },
    );
    await expect(client.generateText({ role: "fast", purpose: "p", prompt: "hi" })).rejects.toThrow(/timed out/i);
    expect(logCall).toHaveBeenCalledWith(expect.objectContaining({ status: "timeout" }));
  });

  it("aborts the provider call when the timeout fires", async () => {
    let seen: AbortSignal | undefined;
    const transport: LlmTransport = {
      async object() { throw new Error("unused"); },
      text(_model, _prompt, _system, signal) {
        seen = signal;
        return new Promise<string>((_res, rej) => signal?.addEventListener("abort", () => rej(new Error("aborted"))));
      },
    };
    const client = createLlmClient(transport, { resolveModel: () => "prov/model", logCall: () => {}, timeoutMs: 10 });
    await expect(client.generateText({ role: "fast", purpose: "t", prompt: "p" })).rejects.toThrow(/timed out/);
    expect(seen?.aborted).toBe(true);
  });

  it("aborts the generateObject path on timeout too", async () => {
    let seen: AbortSignal | undefined;
    const transport: LlmTransport = {
      object(_m, _s, _p, _sys, signal) {
        seen = signal;
        return new Promise((_r, rej) => signal?.addEventListener("abort", () => rej(new Error("aborted"))));
      },
      async text() { throw new Error("unused"); },
    };
    const client = createLlmClient(transport, { resolveModel: () => "prov/model", logCall: () => {}, timeoutMs: 10 });
    await expect(client.generateObject({ role: "hard", purpose: "t", schema: z.object({ x: z.string() }), prompt: "p" })).rejects.toThrow(/timed out/);
    expect(seen?.aborted).toBe(true);
  });
});
