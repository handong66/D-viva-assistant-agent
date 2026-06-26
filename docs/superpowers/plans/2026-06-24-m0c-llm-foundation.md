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
- `src/lib/llm/canary.live.test.ts` — env-gated single-model live structured-output check (Task 8)
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

- [ ] **Step 3: Create `.env.example` (env contract) and allow it past .gitignore**

The repo has no `.env.example`, and `.gitignore` ignores `.env*` (which would hide the template too). Add the example + a negation so it is committable (Codex plan review: env-contract drift / AGENTS doc-sync with spec §14). Run:
```bash
printf '%s\n' \
'# LLM — AI is active only when VIVA_AI_ENABLED=true AND a provider key resolves. Tests always mock.' \
'VIVA_AI_ENABLED=true' \
'VIVA_MODEL_DEFAULT=anthropic/claude-sonnet-4.6' \
'VIVA_MODEL_HARD=anthropic/claude-opus-4.8' \
'VIVA_MODEL_FAST=anthropic/claude-sonnet-4.6' \
'AI_GATEWAY_API_KEY=' \
'GOOGLE_GENERATIVE_AI_API_KEY=' \
'ANTHROPIC_API_KEY=' \
'OPENAI_API_KEY=' \
'# Vertex needs ADC credentials (not just a project id) to count as enabled' \
'GOOGLE_VERTEX_PROJECT=' \
'GOOGLE_APPLICATION_CREDENTIALS=' \
'# STT (default off; google_cloud is explicit opt-in)' \
'STT_PROVIDER=off' \
'# Tests / DB' \
'RUN_LIVE_AI=' \
'VIVA_DB_PATH=./data/viva.sqlite' \
> .env.example
printf '\n# allow the committed env template\n!.env.example\n' >> .gitignore
git check-ignore .env.example >/dev/null && echo "STILL IGNORED — fix .gitignore" || echo "ok: .env.example is trackable"
```
Expected: `ok: .env.example is trackable`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore
git commit -m "chore(m0c): add ai (Vercel AI SDK) + .env.example env contract"
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

> **No hardcoded model names (AGENTS red line, Codex F3).** Model IDs live ONLY in env (`.env.example` ships sane values). `resolveModel` throws clearly when AI is enabled but a role's model env is unset — it never silently defaults to a provider.

- [ ] **Step 1: Write the failing test**

Create `src/lib/llm/model-registry.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveModel, MissingModelEnvError } from "./model-registry";

describe("resolveModel", () => {
  it("returns the env value for the role", () => {
    expect(resolveModel("hard", { VIVA_MODEL_HARD: "openai/gpt-x" })).toBe("openai/gpt-x");
    expect(resolveModel("default", { VIVA_MODEL_DEFAULT: "anthropic/claude-sonnet-4.6" })).toBe(
      "anthropic/claude-sonnet-4.6",
    );
  });

  it("throws a clear error when the role's model env is unset", () => {
    expect(() => resolveModel("fast", {})).toThrow(MissingModelEnvError);
    expect(() => resolveModel("fast", {})).toThrow(/VIVA_MODEL_FAST/);
  });
});
```

- [ ] **Step 2: Run test — FAIL.** Run: `npx vitest run src/lib/llm/model-registry.test.ts`

- [ ] **Step 3: Implement**

Create `src/lib/llm/model-registry.ts`:
```ts
import type { LlmRole } from "./types";

const ENV_KEY: Record<LlmRole, string> = {
  fast: "VIVA_MODEL_FAST",
  default: "VIVA_MODEL_DEFAULT",
  hard: "VIVA_MODEL_HARD",
};

export class MissingModelEnvError extends Error {
  constructor(envKey: string) {
    super(`Model env ${envKey} is not set. Set it (see .env.example) or disable AI.`);
    this.name = "MissingModelEnvError";
  }
}

/** Resolve a role to an AI Gateway "provider/model" string from env. No hardcoded defaults. */
export function resolveModel(
  role: LlmRole,
  env: Record<string, string | undefined> = process.env,
): string {
  const key = ENV_KEY[role];
  const value = env[key];
  if (!value) throw new MissingModelEnvError(key);
  return value;
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

  it("times out a slow call and logs status=timeout", async () => {
    const logCall = vi.fn();
    const client = createLlmClient(
      fakeTransport({ text: () => new Promise<string>(() => {}) }), // never resolves
      { resolveModel: () => "anthropic/x", logCall, timeoutMs: 10 },
    );
    await expect(client.generateText({ role: "fast", purpose: "p", prompt: "hi" })).rejects.toThrow(/timed out/i);
    expect(logCall).toHaveBeenCalledWith(expect.objectContaining({ status: "timeout" }));
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
  /** Per-call timeout; defaults to 25s (spec §8). */
  timeoutMs?: number;
};

export class LlmTimeoutError extends Error {
  constructor(ms: number) {
    super(`LLM call timed out after ${ms}ms`);
    this.name = "LlmTimeoutError";
  }
}

function providerOf(model: string): string {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : "unknown";
}

function withTimeout<R>(p: Promise<R>, ms: number): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    const t = setTimeout(() => reject(new LlmTimeoutError(ms)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export function createLlmClient(transport: LlmTransport, deps: ClientDeps): LlmClient {
  const timeoutMs = deps.timeoutMs ?? 25_000;
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
      const result = await withTimeout(op(model), timeoutMs);
      deps.logCall({ thesisId, purpose, provider, model, latencyMs: Date.now() - started, status: "ok" });
      return result;
    } catch (err) {
      const status = err instanceof LlmTimeoutError ? "timeout" : "error";
      deps.logCall({
        thesisId, purpose, provider, model, latencyMs: Date.now() - started,
        status, error: err instanceof Error ? err.message : String(err),
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

- [ ] **Step 3: Implement** — append to `src/db/repository.ts` (the DB layer owns its own input type — it must NOT import from `lib/llm`, Codex F5):
```ts
import { randomUUID } from "node:crypto";

export type AiCallLogInput = {
  thesisId?: string;
  purpose: string;
  provider: string;
  model: string;
  latencyMs: number;
  status: "ok" | "error" | "timeout";
  error?: string;
};

export function logAiCall(db: DB, entry: AiCallLogInput): void {
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
> Put the `randomUUID` import at the top with the existing imports. `client.ts` keeps its own structurally-identical `AiCallLog` type; the factory passes client entries to `logAiCall` and TS structural typing accepts them — no cross-layer import.

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
```

- [ ] **Step 2: Run test — FAIL.**

- [ ] **Step 2b: Calibrate the AI SDK API against the installed package (Codex F2)**

Before writing the transport, prove the installed `ai` package's API — do not write the SDK call from memory (spec §17). Run:
```bash
ls node_modules/ai/docs >/dev/null 2>&1 && echo "docs present" || echo "no bundled docs — use ai-sdk.dev"
grep -rl "generateObject" node_modules/ai/docs 2>/dev/null | head -3
```
Open the matched doc (and `node_modules/ai/src` if needed), follow the `vercel:ai-sdk` skill, and confirm: (a) the exact `generateObject` / `generateText` argument + return shape, and (b) that a plain `"provider/model"` string is accepted as `model` via the AI Gateway. Only write `transport.ts` once confirmed; correct the shape below if the installed version differs.

- [ ] **Step 3: Implement the AI SDK transport** (the ONLY AI-SDK touch-point)

Create `src/lib/llm/transport.ts`:
```ts
import "server-only";
import { generateObject, generateText } from "ai";
import type { z } from "zod";
import type { LlmTransport } from "./types";

// NOTE: verify generateObject/generateText signatures against node_modules/ai/docs
// (see vercel:ai-sdk skill). Models are AI Gateway "provider/model" strings; set
// AI_GATEWAY_API_KEY in the environment (M0c is Gateway-only).
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

export async function getLlmClient(
  db: DB,
  opts: { effectiveAiEnabled: boolean; gatewayConfigured: boolean; override?: LlmClient },
): Promise<LlmClient> {
  if (opts.override) return opts.override;
  // M0c routes via the AI Gateway (only `ai` is installed): models are
  // "provider/model" strings the Gateway resolves with AI_GATEWAY_API_KEY, so any
  // provider works and there's no provider/key mismatch (Codex F4). Need both the
  // intent flag AND the gateway credential; otherwise degrade to disabled.
  if (!opts.effectiveAiEnabled || !opts.gatewayConfigured) return disabledClient();
  // Dynamic import keeps the AI SDK out of the test path (tests pass `override`
  // or a disabled combo) and is ESLint-clean (no `require`, Codex-confirmed
  // `@typescript-eslint/no-require-imports`).
  const { aiSdkTransport } = await import("./transport");
  return createLlmClient(aiSdkTransport(), {
    resolveModel,
    logCall: (entry) => logAiCall(db, entry),
  });
}
```
> **M0c is AI-Gateway-only.** Callers derive `gatewayConfigured` from `!!AI_GATEWAY_API_KEY` (config exposes it) and `effectiveAiEnabled` from config; both are required. Direct per-provider-package routing is deferred to a later milestone. **Disabled-client calls are intentionally NOT written to `ai_call_log`** (no model call is made; Codex F6). `getLlmClient` is async — future M2/M3 callers `await` it; no callers exist yet.

- [ ] **Step 5: Run test — PASS.** Run: `npx vitest run src/lib/llm/index.test.ts`

- [ ] **Step 6: Typecheck + lint, then commit**

Run: `npm run typecheck && npm run lint`
```bash
git add src/lib/llm/transport.ts src/lib/llm/index.ts src/lib/llm/index.test.ts
git commit -m "feat(m0c): AI SDK transport + factory with graceful degradation"
```

---

### Task 8: Single-model live canary + full gate

> Scope note (Codex F7): this is a **single-model** live smoke of the configured `default` model — not true cross-provider conformance. Iterating an env-driven list of provider models is deferred to the consumers (M2/M3).

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
git commit -m "test(m0c): env-gated single-model live structured-output canary"
```

- [ ] **Step 5 (optional, manual): run the live canary once** if the gateway is configured:
`RUN_LIVE_AI=1 AI_GATEWAY_API_KEY=... VIVA_MODEL_DEFAULT=anthropic/claude-sonnet-4.6 npx vitest run src/lib/llm/canary.live.test.ts`

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
