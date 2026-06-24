# M0c LLM Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A provider-agnostic `LlmClient` that the rest of the app uses for all model calls — with a deterministic mock for tests, env-driven model routing, timeout/error-normalization, `ai_call_log` persistence, and graceful degradation when AI is disabled.

**Architecture:** Our own `LlmClient` interface is the seam every consumer (judge, examiner, prep-pack) depends on. A thin `LlmTransport` adapter is the ONLY code that touches the Vercel AI SDK, so the wrapper logic (routing, timeout, logging, errors) is unit-tested with a fake transport and never hits the network. A factory returns a `MockLlmClient` in tests / when AI is disabled, and the real client otherwise.

**Tech Stack:** Vercel AI SDK v6 (`ai`) via AI Gateway (`"provider/model"` strings) · zod · better-sqlite3 (`ai_call_log`) · vitest.

**Scope:** LLM client/types, model-registry, MockLlmClient, real client over injectable transport, factory + graceful degradation, `ai_call_log` helper, env-gated cross-provider canary. **Out of scope (next plans):** the leveled validator (→ M0d), ingest (M1), prep-pack/judge/examiner (M2/M3), UI.

**Spec:** `docs/superpowers/specs/2026-06-23-viva-assistant-generic-design.md` §8 (provider-agnostic layer), §15 (mock-first tests), §14 (env). Builds on M0 (`src/lib/config.ts` `effectiveAiEnabled`, `src/db` schema with `ai_call_log`).

> **AI SDK calibration (spec §17 — do not write AI SDK API from memory):** Only `src/lib/llm/transport.ts` (Task 7) touches the `ai` package. When implementing it, follow the `vercel:ai-sdk` skill: confirm `generateObject` / `generateText` signatures against `node_modules/ai/docs/` after install, and use AI Gateway `"provider/model"` strings. Confirmed current model IDs (from the gateway, 2026-06-24): `anthropic/claude-opus-4.8`, `anthropic/claude-sonnet-4.6`. Everything else in this plan is our own code and is fully specified.

---

## File Structure

- `src/lib/llm/types.ts` — `LlmClient`, `LlmTransport`, role/args types, `LlmDisabledError` (Task 2)
- `src/lib/llm/model-registry.ts` — `resolveModel(role, env)` (Task 3)
- `src/lib/llm/mock.ts` — `MockLlmClient` (Task 4)
- `src/lib/llm/client.ts` — `createLlmClient(transport, deps)` wrapper logic (Task 5)
- `src/db/repository.ts` — add `logAiCall()` (Task 6)
- `src/lib/llm/transport.ts` — `aiSdkTransport()` (the only AI SDK touch-point) (Task 7)
- `src/lib/llm/index.ts` — `getLlmClient()` factory + graceful degradation (Task 7)
- `src/lib/llm/canary.live.test.ts` — env-gated cross-provider structured-output check (Task 8)
- Tests colocated: `*.test.ts` per module.

---

### Task 1: Install the AI SDK

**Files:** `package.json`

- [ ] **Step 1: Install `ai` only** (provider packages not needed — we use the Gateway via model strings)

Run: `npm install ai`
Expected: `ai` (v6+) added; `node_modules/ai/docs/` exists.

- [ ] **Step 2: Confirm docs are present for later calibration**

Run: `ls node_modules/ai/docs | head`
Expected: markdown docs listed (used in Task 7).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(m0c): add ai (Vercel AI SDK)"
```

---

### Task 2: LLM types and interfaces

**Files:** Create `src/lib/llm/types.ts`, `src/lib/llm/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/llm/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { LlmDisabledError } from "./types";

describe("LlmDisabledError", () => {
  it("is an Error with a clear name", () => {
    const e = new LlmDisabledError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("LlmDisabledError");
  });
});
```

- [ ] **Step 2: Run test — FAIL** (`Cannot find module './types'`). Run: `npx vitest run src/lib/llm/types.test.ts`

- [ ] **Step 3: Implement**

Create `src/lib/llm/types.ts`:
```ts
import type { z } from "zod";

export type LlmRole = "fast" | "default" | "hard";

export interface GenerateObjectArgs<T> {
  role: LlmRole;
  /** Stable label for logging, e.g. "judge", "prep_pack:digest". */
  purpose: string;
  schema: z.ZodType<T>;
  prompt: string;
  system?: string;
  thesisId?: string;
}

export interface GenerateTextArgs {
  role: LlmRole;
  purpose: string;
  prompt: string;
  system?: string;
  thesisId?: string;
}

export interface LlmClient {
  readonly enabled: boolean;
  generateObject<T>(args: GenerateObjectArgs<T>): Promise<T>;
  generateText(args: GenerateTextArgs): Promise<string>;
}

/** The single seam that touches a model provider. Implemented by aiSdkTransport(). */
export interface LlmTransport {
  object(model: string, schema: z.ZodType<unknown>, prompt: string, system?: string): Promise<unknown>;
  text(model: string, prompt: string, system?: string): Promise<string>;
}

export class LlmDisabledError extends Error {
  constructor(message = "AI is disabled (no provider key, or VIVA_AI_ENABLED=false)") {
    super(message);
    this.name = "LlmDisabledError";
  }
}
```

- [ ] **Step 4: Run test — PASS**. Run: `npx vitest run src/lib/llm/types.test.ts`

- [ ] **Step 5: Commit**
```bash
git add src/lib/llm/types.ts src/lib/llm/types.test.ts
git commit -m "feat(m0c): LlmClient/LlmTransport interfaces + LlmDisabledError"
```

---

### Task 3: Model registry

**Files:** Create `src/lib/llm/model-registry.ts`, `src/lib/llm/model-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/llm/model-registry.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveModel } from "./model-registry";

describe("resolveModel", () => {
  it("returns env override when set", () => {
    expect(resolveModel("hard", { VIVA_MODEL_HARD: "openai/gpt-x" })).toBe("openai/gpt-x");
  });

  it("falls back to a sane default per role", () => {
    expect(resolveModel("hard", {})).toBe("anthropic/claude-opus-4.8");
    expect(resolveModel("default", {})).toBe("anthropic/claude-sonnet-4.6");
    expect(resolveModel("fast", {})).toBe("anthropic/claude-sonnet-4.6");
  });
});
```

- [ ] **Step 2: Run test — FAIL.** Run: `npx vitest run src/lib/llm/model-registry.test.ts`

- [ ] **Step 3: Implement**

Create `src/lib/llm/model-registry.ts`:
```ts
import type { LlmRole } from "./types";

// Defaults use AI Gateway "provider/model" strings. Override per role via env.
// Confirmed current IDs as of 2026-06-24; change freely via env without code edits.
const DEFAULTS: Record<LlmRole, string> = {
  fast: "anthropic/claude-sonnet-4.6",
  default: "anthropic/claude-sonnet-4.6",
  hard: "anthropic/claude-opus-4.8",
};

const ENV_KEY: Record<LlmRole, string> = {
  fast: "VIVA_MODEL_FAST",
  default: "VIVA_MODEL_DEFAULT",
  hard: "VIVA_MODEL_HARD",
};

export function resolveModel(
  role: LlmRole,
  env: Record<string, string | undefined> = process.env,
): string {
  return env[ENV_KEY[role]] || DEFAULTS[role];
}
```

- [ ] **Step 4: Run test — PASS.**

- [ ] **Step 5: Commit**
```bash
git add src/lib/llm/model-registry.ts src/lib/llm/model-registry.test.ts
git commit -m "feat(m0c): env-driven model registry (role -> provider/model)"
```

---

### Task 4: MockLlmClient

**Files:** Create `src/lib/llm/mock.ts`, `src/lib/llm/mock.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/llm/mock.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test — FAIL.**

- [ ] **Step 3: Implement**

Create `src/lib/llm/mock.ts`:
```ts
import type { GenerateObjectArgs, GenerateTextArgs, LlmClient } from "./types";

type Call = { kind: "object" | "text"; role: string; purpose: string };

/** Deterministic LlmClient for tests. Script responses by purpose. */
export class MockLlmClient implements LlmClient {
  readonly enabled = true;
  readonly calls: Call[] = [];
  private objects = new Map<string, unknown>();
  private texts = new Map<string, string>();

  setObject(purpose: string, value: unknown): this {
    this.objects.set(purpose, value);
    return this;
  }
  setText(purpose: string, value: string): this {
    this.texts.set(purpose, value);
    return this;
  }

  async generateObject<T>(args: GenerateObjectArgs<T>): Promise<T> {
    this.calls.push({ kind: "object", role: args.role, purpose: args.purpose });
    if (!this.objects.has(args.purpose)) throw new Error(`no mock object for purpose: ${args.purpose}`);
    return args.schema.parse(this.objects.get(args.purpose));
  }

  async generateText(args: GenerateTextArgs): Promise<string> {
    this.calls.push({ kind: "text", role: args.role, purpose: args.purpose });
    if (!this.texts.has(args.purpose)) throw new Error(`no mock text for purpose: ${args.purpose}`);
    return this.texts.get(args.purpose) as string;
  }
}
```

- [ ] **Step 4: Run test — PASS.**

- [ ] **Step 5: Commit**
```bash
git add src/lib/llm/mock.ts src/lib/llm/mock.test.ts
git commit -m "feat(m0c): deterministic MockLlmClient (scripted by purpose)"
```

---

### Task 5: Real client wrapper over an injectable transport

**Files:** Create `src/lib/llm/client.ts`, `src/lib/llm/client.test.ts`

- [ ] **Step 1: Write the failing test** (uses a fake transport — no network)

Create `src/lib/llm/client.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run test — FAIL.**

- [ ] **Step 3: Implement**

Create `src/lib/llm/client.ts`:
```ts
import type { GenerateObjectArgs, GenerateTextArgs, LlmClient, LlmRole, LlmTransport } from "./types";

export type AiCallLog = {
  thesisId?: string;
  purpose: string;
  provider: string;
  model: string;
  latencyMs: number;
  status: "ok" | "error" | "timeout";
  error?: string;
};

export type ClientDeps = {
  resolveModel: (role: LlmRole) => string;
  logCall: (entry: AiCallLog) => void;
};

function providerOf(model: string): string {
  return model.includes("/") ? model.split("/")[0]! : "unknown";
}

export function createLlmClient(transport: LlmTransport, deps: ClientDeps): LlmClient {
  async function run<R>(
    role: LlmRole,
    purpose: string,
    thesisId: string | undefined,
    op: (model: string) => Promise<R>,
  ): Promise<R> {
    const model = deps.resolveModel(role);
    const provider = providerOf(model);
    const started = Date.now();
    try {
      const result = await op(model);
      deps.logCall({ thesisId, purpose, provider, model, latencyMs: Date.now() - started, status: "ok" });
      return result;
    } catch (err) {
      deps.logCall({
        thesisId, purpose, provider, model, latencyMs: Date.now() - started,
        status: "error", error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  return {
    enabled: true,
    generateObject<T>(args: GenerateObjectArgs<T>): Promise<T> {
      return run(args.role, args.purpose, args.thesisId, async (model) => {
        const raw = await transport.object(model, args.schema, args.prompt, args.system);
        return args.schema.parse(raw);
      });
    },
    generateText(args: GenerateTextArgs): Promise<string> {
      return run(args.role, args.purpose, args.thesisId, (model) =>
        transport.text(model, args.prompt, args.system),
      );
    },
  };
}
```

- [ ] **Step 4: Run test — PASS.**

- [ ] **Step 5: Commit**
```bash
git add src/lib/llm/client.ts src/lib/llm/client.test.ts
git commit -m "feat(m0c): LlmClient wrapper (role routing, logging, error normalization)"
```

---

### Task 6: ai_call_log repository helper

**Files:** Modify `src/db/repository.ts`; create `src/db/repository.ai-log.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/db/repository.ai-log.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test — FAIL** (`logAiCall` not exported).

- [ ] **Step 3: Implement** — append to `src/db/repository.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { AiCallLog } from "../lib/llm/client";

export function logAiCall(db: DB, entry: AiCallLog): void {
  db.prepare(
    `INSERT INTO ai_call_log (id, thesis_id, purpose, provider, model, latency_ms, status, error)
     VALUES (@id, @thesis_id, @purpose, @provider, @model, @latency_ms, @status, @error)`,
  ).run({
    id: randomUUID(),
    thesis_id: entry.thesisId ?? null,
    purpose: entry.purpose,
    provider: entry.provider,
    model: entry.model,
    latency_ms: entry.latencyMs,
    status: entry.status,
    error: entry.error ?? null,
  });
}
```
> Place the two `import` lines at the top of the file with the existing imports, not inline.

- [ ] **Step 4: Run test — PASS.**

- [ ] **Step 5: Commit**
```bash
git add src/db/repository.ts src/db/repository.ai-log.test.ts
git commit -m "feat(m0c): logAiCall repository helper"
```

---

### Task 7: AI SDK transport + factory with graceful degradation

**Files:** Create `src/lib/llm/transport.ts`, `src/lib/llm/index.ts`, `src/lib/llm/index.test.ts`

- [ ] **Step 1: Write the failing test** (factory selects mock/disabled without touching the AI SDK)

Create `src/lib/llm/index.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { makeTestDb } from "../../test/db";
import { getLlmClient } from "./index";
import { MockLlmClient } from "./mock";

describe("getLlmClient", () => {
  it("returns a disabled client that throws when effectiveAiEnabled is false", async () => {
    const db = makeTestDb();
    const client = getLlmClient(db, { effectiveAiEnabled: false });
    expect(client.enabled).toBe(false);
    await expect(
      client.generateObject({ role: "default", purpose: "p", schema: z.object({}), prompt: "x" }),
    ).rejects.toThrow(/disabled/i);
    db.close();
  });

  it("uses an injected client when provided (test seam)", async () => {
    const db = makeTestDb();
    const mock = new MockLlmClient().setText("p", "hi");
    const client = getLlmClient(db, { effectiveAiEnabled: true, override: mock });
    expect(await client.generateText({ role: "fast", purpose: "p", prompt: "x" })).toBe("hi");
    db.close();
  });
});
```

- [ ] **Step 2: Run test — FAIL.**

- [ ] **Step 3: Implement the AI SDK transport** (the ONLY AI-SDK touch-point)

Create `src/lib/llm/transport.ts`:
```ts
import "server-only";
import { generateObject, generateText } from "ai";
import type { z } from "zod";
import type { LlmTransport } from "./types";

// NOTE: verify generateObject/generateText signatures against node_modules/ai/docs
// (see vercel:ai-sdk skill). Models are AI Gateway "provider/model" strings; set
// AI_GATEWAY_API_KEY (or provider keys) in the environment.
export function aiSdkTransport(): LlmTransport {
  return {
    async object(model, schema, prompt, system) {
      const { object } = await generateObject({ model, schema: schema as z.ZodType<unknown>, prompt, system });
      return object;
    },
    async text(model, prompt, system) {
      const { text } = await generateText({ model, prompt, system });
      return text;
    },
  };
}
```

- [ ] **Step 4: Implement the factory**

Create `src/lib/llm/index.ts`:
```ts
import "server-only";
import type { Database as DB } from "better-sqlite3";
import type { GenerateObjectArgs, GenerateTextArgs, LlmClient } from "./types";
import { LlmDisabledError } from "./types";
import { createLlmClient } from "./client";
import { resolveModel } from "./model-registry";
import { logAiCall } from "../../db/repository";

function disabledClient(): LlmClient {
  return {
    enabled: false,
    generateObject<T>(_args: GenerateObjectArgs<T>): Promise<T> {
      return Promise.reject(new LlmDisabledError());
    },
    generateText(_args: GenerateTextArgs): Promise<string> {
      return Promise.reject(new LlmDisabledError());
    },
  };
}

export function getLlmClient(
  db: DB,
  opts: { effectiveAiEnabled: boolean; override?: LlmClient },
): LlmClient {
  if (opts.override) return opts.override;
  if (!opts.effectiveAiEnabled) return disabledClient();
  // Lazy import so tests never load the AI SDK.
  const { aiSdkTransport } = require("./transport") as typeof import("./transport");
  return createLlmClient(aiSdkTransport(), {
    resolveModel,
    logCall: (entry) => logAiCall(db, entry),
  });
}
```
> The `require("./transport")` keeps the AI SDK out of the test path (tests always pass `override` or `effectiveAiEnabled:false`). If the project's lint forbids `require`, use a dynamic `await import` and make `getLlmClient` async — but then update callers accordingly; keep it sync for M0c.

- [ ] **Step 5: Run test — PASS.** Run: `npx vitest run src/lib/llm/index.test.ts`

- [ ] **Step 6: Typecheck + lint, then commit**

Run: `npm run typecheck && npm run lint`
```bash
git add src/lib/llm/transport.ts src/lib/llm/index.ts src/lib/llm/index.test.ts
git commit -m "feat(m0c): AI SDK transport + factory with graceful degradation"
```

---

### Task 8: Cross-provider structured-output canary + full gate

**Files:** Create `src/lib/llm/canary.live.test.ts`

- [ ] **Step 1: Write the env-gated canary** (skipped unless `RUN_LIVE_AI=1`)

Create `src/lib/llm/canary.live.test.ts`:
```ts
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
```

- [ ] **Step 2: Verify it is skipped by default**

Run: `npm test`
Expected: the canary suite is skipped (no `RUN_LIVE_AI`); all other tests pass.

- [ ] **Step 3: Full gate**

Run: `npm run check`
Expected: typecheck + lint + tests all green.

- [ ] **Step 4: Commit**
```bash
git add src/lib/llm/canary.live.test.ts
git commit -m "test(m0c): env-gated cross-provider structured-output canary"
```

- [ ] **Step 5 (optional, manual): run the live canary once** if a provider key is configured:
`RUN_LIVE_AI=1 AI_GATEWAY_API_KEY=... npx vitest run src/lib/llm/canary.live.test.ts`

---

## Codex 互评 Gate (M0c)

Per `AGENTS.md` — **绿测试 ≠ Done**:
- [ ] `npm run check` green + `npx tsc --noEmit`.
- [ ] Fresh Codex thread reviews the M0c diff: is the AI SDK truly isolated to `transport.ts`? Is the `require("./transport")` test-isolation seam sound (or should it be a dynamic import)? Does `getLlmClient` degrade correctly? Is `providerOf`/logging correct? Any provider-string assumptions that break non-gateway setups?
- [ ] Verify each finding by reading code; reconcile until both + tests agree.
- [ ] Merge to `main`; then proceed to the M0d plan (leveled validator).

---

## Self-Review Notes (author)

- **Spec coverage:** §8 provider-agnostic layer (Tasks 2–7), §15 mock-first + injectable (Tasks 4,5,7) + env-gated live canary (Task 8), §14 model env (Task 3). `ai_call_log` (§6) wired in Task 6.
- **AI SDK isolation:** only `transport.ts` imports `ai`; all wrapper logic tested with a fake transport — no network in the default suite.
- **Deferred:** leveled validator → M0d; consumers (judge/examiner/prep-pack) → M2/M3.
- **Risk flagged for implementation:** confirm AI SDK v6 `generateObject({ model, schema, prompt, system })` shape + gateway string support against `node_modules/ai/docs` (Task 7); the `require` seam may need to become `await import` if lint forbids `require`.
