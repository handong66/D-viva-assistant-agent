# M5a — STT Backend (provider-agnostic transcription + recordings) Implementation Plan

> **For agentic workers:** This project runs the Claude↔Codex 老流程 (see `AGENTS.md`): **Codex implements** each task via `codex:codex-rescue` (`--write`); **Claude runs tests + reviews + commits** per task and at a milestone gate (绿测试≠Done). Steps use checkbox (`- [ ]`) syntax.

**Goal:** The testable STT foundation (spec §12): a provider-agnostic `lib/stt` (transport interface + mock + a real google_cloud REST transport, gated by config), `recording` repository helpers, and a `transcribeRecording` service that turns recorded audio into a `practice_run.transcript` the existing judge already consumes (`answer_text || transcript`). **Off/local-first by default** — STT only sends audio out when `STT_PROVIDER=google_cloud` AND a key is set (the §3 明告 already discloses this).

**Architecture:** Mirror `lib/llm` exactly: `types` (the seam) → `mock` (tests) → `google` (real fetch-based transport) → `index` (`getSttTransport(config)` gates on `sttProvider` + key). The transcribe service takes an injected transport (mock in tests), writes the transcript onto the `recording` and the linked `practice_run`, and degrades gracefully (errors → `stt_status='error'`, never throws into the request). **No browser/audio capture here** — that is M5b (MediaRecorder UI + upload action). This slice is 100% unit-testable.

**Tech Stack:** TypeScript (strict), zod (config), better-sqlite3, vitest, `fetch` (Node 20+ global) for the GCP REST call. STT is an optional outbound call, key only in env, mock in tests (red lines #3/#5).

> **M5 decomposition:** **M5a = STT backend (this plan)** → M5b = browser record UI (MediaRecorder → upload action → transcribeRecording) + the `browser` Web Speech path. M5a delivers no UI; it is the layer M5b drives, exactly as `lib/llm` (M0c) preceded its UI.
>
> **v1 scope notes:** the `browser` STT provider is transcribed client-side (M5b) — server-side `getSttTransport` treats `off` and `browser` as **disabled** (no server transcription). Only `google_cloud` has a server transport. Real GCP calls are env-gated (key required); tests mock `fetch`.

> **Revised after Codex design-review round 1** (CONDITIONAL GO → fixes integrated): **P1** GCP requires `sampleRateHertz` for *_OPUS → the transport now sends `encoding`+`sampleRateHertz:48000` for webm/ogg Opus and omits both for WAV/other (GCP detects). **P1** spec §12 said `chirp_2` (a v2 model) but M5a uses v1 `speech:recognize` → spec reconciled to "v1 default model; v2/chirp_2 later". **P1** `insertRecording` now enforces the linked `practice_run` belongs to the recording's thesis (so `setRecordingTranscript` can't copy a transcript across theses). **P2** test restores `process.env.GOOGLE_STT_API_KEY` in afterEach. (Codex confirmed the lib/llm-mirrored abstraction, the recording lifecycle, the transcript→judge flow, and the local-first/key-in-env red lines as already correct.) **Known v1 limitation:** multi-segment results are joined with a single space — fine for the common single-result short answer and for English; Chinese multi-segment spacing is a minor later refinement (alongside long-running recognition for >1 min audio).

---

## Contracts

```ts
// src/lib/stt/types.ts
export type SttResult = { transcript: string };
export type SttOpts = { mime: string; languageMode: "english" | "chinese" };
export interface SttTransport {
  readonly enabled: boolean;
  transcribe(audio: Uint8Array, opts: SttOpts): Promise<SttResult>;
}
export class SttDisabledError extends Error {}

// src/lib/config.ts — add
//   GOOGLE_STT_API_KEY?: string (env)
//   sttConfigured: boolean   // sttProvider === "google_cloud" && Boolean(GOOGLE_STT_API_KEY)

// src/db/repository.ts
export type NewRecording = { thesisId: string; practiceRunId?: string; path: string; mime: string; durationMs?: number; languageMode: "english" | "chinese"; sttProvider: string };
export function insertRecording(db: DB, r: NewRecording): string;
export function setRecordingTranscript(db: DB, recordingId: string, transcript: string): void; // also copies to the linked practice_run
export function setRecordingError(db: DB, recordingId: string, error: string): void;

// src/lib/stt/transcribe.ts
export function transcribeRecording(db: DB, stt: SttTransport, args: { recordingId: string; audio: Uint8Array }): Promise<{ status: "ok" | "skipped" | "error"; transcript?: string }>;
```

## File structure (mirrors `lib/llm`)

- **Create** `src/lib/stt/types.ts` — the seam.
- **Create** `src/lib/stt/mock.ts` (+`mock.test.ts` is folded into transcribe tests) — `MockSttTransport`.
- **Create** `src/lib/stt/google.ts` (+`google.test.ts`) — GCP Speech REST transport (fetch-mocked).
- **Create** `src/lib/stt/index.ts` (+`index.test.ts`) — `getSttTransport(config, override?)` gating.
- **Modify** `src/lib/config.ts` (+ update its test) + `.env.example` — `GOOGLE_STT_API_KEY` + `sttConfigured`.
- **Modify** `src/db/repository.ts` (+`repository.recording.test.ts`) — recording helpers.
- **Create** `src/lib/stt/transcribe.ts` (+`transcribe.test.ts`) — the service.

---

### Task 1: config — `GOOGLE_STT_API_KEY` + `sttConfigured`

**Files:** Modify `src/lib/config.ts`, `.env.example`, and the existing config test.

- [ ] **Step 1: Add the failing assertion** — in the existing config test file (find it: `src/lib/config.test.ts`), add:

```ts
it("sttConfigured requires google_cloud provider AND a key", () => {
  expect(loadConfig({ STT_PROVIDER: "google_cloud", GOOGLE_STT_API_KEY: "k" }).sttConfigured).toBe(true);
  expect(loadConfig({ STT_PROVIDER: "google_cloud" }).sttConfigured).toBe(false);
  expect(loadConfig({ STT_PROVIDER: "browser", GOOGLE_STT_API_KEY: "k" }).sttConfigured).toBe(false);
  expect(loadConfig({}).sttConfigured).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/config.test.ts` — FAIL (`sttConfigured` undefined).

- [ ] **Step 3: Implement** — in `src/lib/config.ts`: add `GOOGLE_STT_API_KEY: z.string().optional()` to `EnvSchema`; add `sttConfigured: boolean` to the `Config` type; in the returned object add `sttConfigured: parsed.STT_PROVIDER === "google_cloud" && Boolean(parsed.GOOGLE_STT_API_KEY)`. In `.env.example`, under the STT line add `GOOGLE_STT_API_KEY=` (commented intent: only needed for google_cloud STT).

- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(m5a): config GOOGLE_STT_API_KEY + sttConfigured (Task 1)"`

---

### Task 2: `lib/stt` types + mock + `getSttTransport` gating

**Files:** Create `src/lib/stt/types.ts`, `src/lib/stt/mock.ts`, `src/lib/stt/index.ts`, `src/lib/stt/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/stt/index.test.ts
import { describe, it, expect } from "vitest";
import { getSttTransport } from "./index";
import { MockSttTransport } from "./mock";

const base = { aiFlag: true, hasProviderKey: false, gatewayConfigured: false, effectiveAiEnabled: false, dbPath: ":memory:", runLiveAi: false };

describe("getSttTransport", () => {
  it("returns a disabled transport for off/browser, and when google_cloud lacks a key", () => {
    expect(getSttTransport({ ...base, sttProvider: "off", sttConfigured: false }).enabled).toBe(false);
    expect(getSttTransport({ ...base, sttProvider: "browser", sttConfigured: false }).enabled).toBe(false);
    expect(getSttTransport({ ...base, sttProvider: "google_cloud", sttConfigured: false }).enabled).toBe(false);
  });
  it("a disabled transport rejects when transcribe is called", async () => {
    await expect(getSttTransport({ ...base, sttProvider: "off", sttConfigured: false }).transcribe(new Uint8Array(), { mime: "audio/webm", languageMode: "english" })).rejects.toThrow();
  });
  it("honours an injected override (for tests)", () => {
    const mock = new MockSttTransport("hello");
    expect(getSttTransport({ ...base, sttProvider: "off", sttConfigured: false }, mock)).toBe(mock);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (modules missing).

- [ ] **Step 3: Implement**

```ts
// src/lib/stt/types.ts
export type SttResult = { transcript: string };
export type SttOpts = { mime: string; languageMode: "english" | "chinese" };
export interface SttTransport {
  readonly enabled: boolean;
  transcribe(audio: Uint8Array, opts: SttOpts): Promise<SttResult>;
}
export class SttDisabledError extends Error {
  constructor(message = "STT is disabled (STT_PROVIDER is not google_cloud, or no key)") {
    super(message);
    this.name = "SttDisabledError";
  }
}
```

```ts
// src/lib/stt/mock.ts
import type { SttTransport, SttResult, SttOpts } from "./types";

export class MockSttTransport implements SttTransport {
  readonly enabled = true;
  readonly calls: SttOpts[] = [];
  constructor(private readonly transcript: string) {}
  async transcribe(_audio: Uint8Array, opts: SttOpts): Promise<SttResult> {
    this.calls.push(opts);
    return { transcript: this.transcript };
  }
}
```

```ts
// src/lib/stt/index.ts
import "server-only";
import type { Config } from "../config";
import type { SttTransport, SttOpts } from "./types";
import { SttDisabledError } from "./types";
import { googleSttTransport } from "./google";

function disabledTransport(): SttTransport {
  return {
    enabled: false,
    transcribe(_audio: Uint8Array, _opts: SttOpts) {
      return Promise.reject(new SttDisabledError());
    },
  };
}

/** Server-side STT. `off`/`browser` are disabled here (browser transcribes client-side in M5b);
 *  only a configured google_cloud provider returns a live transport. */
export function getSttTransport(config: Config, override?: SttTransport): SttTransport {
  if (override) return override;
  if (config.sttProvider === "google_cloud" && config.sttConfigured) {
    return googleSttTransport();
  }
  return disabledTransport();
}
```

> `index.ts` imports `googleSttTransport` (Task 3) — create the files in this order, or stub `google.ts` first.

- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(m5a): lib/stt types + mock + getSttTransport gating (Task 2)"`

---

### Task 3: `googleSttTransport` — GCP Speech REST (fetch-mocked)

**Files:** Create `src/lib/stt/google.ts`, `src/lib/stt/google.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/stt/google.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { googleSttTransport } from "./google";

const savedKey = process.env.GOOGLE_STT_API_KEY;
afterEach(() => {
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env.GOOGLE_STT_API_KEY;
  else process.env.GOOGLE_STT_API_KEY = savedKey;
});

describe("googleSttTransport", () => {
  it("posts base64 audio with opus encoding + 48kHz and returns the joined transcript", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [{ alternatives: [{ transcript: "hello" }] }, { alternatives: [{ transcript: "world" }] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.GOOGLE_STT_API_KEY = "test-key";

    const out = await googleSttTransport().transcribe(new Uint8Array([1, 2, 3]), { mime: "audio/webm", languageMode: "english" });
    expect(out.transcript).toBe("hello world");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("speech.googleapis.com");
    expect(String(url)).toContain("key=test-key");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.config).toMatchObject({ languageCode: "en-US", encoding: "WEBM_OPUS", sampleRateHertz: 48000 });
    expect(body.audio.content).toBe(Buffer.from([1, 2, 3]).toString("base64"));
  });
  it("throws on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));
    process.env.GOOGLE_STT_API_KEY = "k";
    await expect(googleSttTransport().transcribe(new Uint8Array([1]), { mime: "audio/webm", languageMode: "chinese" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/stt/google.ts
import "server-only";
import type { SttTransport, SttResult, SttOpts } from "./types";

const LANGS: Record<SttOpts["languageMode"], string> = { english: "en-US", chinese: "cmn-Hans-CN" };

// MediaRecorder Opus is always 48 kHz, and GCP requires sampleRateHertz for *_OPUS.
// WAV/other → omit encoding + rate and let GCP detect from the header.
function opusEncoding(mime: string): "WEBM_OPUS" | "OGG_OPUS" | null {
  if (mime.includes("webm")) return "WEBM_OPUS";
  if (mime.includes("ogg")) return "OGG_OPUS";
  return null;
}

export function googleSttTransport(): SttTransport {
  return {
    enabled: true,
    async transcribe(audio: Uint8Array, opts: SttOpts): Promise<SttResult> {
      const key = process.env.GOOGLE_STT_API_KEY;
      if (!key) throw new Error("GOOGLE_STT_API_KEY not set");
      const encoding = opusEncoding(opts.mime);
      const config: Record<string, unknown> = { languageCode: LANGS[opts.languageMode] };
      if (encoding) { config.encoding = encoding; config.sampleRateHertz = 48000; }
      const res = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config, audio: { content: Buffer.from(audio).toString("base64") } }),
      });
      if (!res.ok) throw new Error(`google STT failed: ${res.status}`);
      const data = (await res.json()) as { results?: { alternatives?: { transcript?: string }[] }[] };
      const transcript = (data.results ?? [])
        .map((r) => r.alternatives?.[0]?.transcript ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return { transcript };
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(m5a): googleSttTransport (GCP Speech REST, fetch-mocked) (Task 3)"`

---

### Task 4: `recording` repository helpers

**Files:** Modify `src/db/repository.ts`, Create `src/db/repository.recording.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/db/repository.recording.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { insertRecording, setRecordingTranscript, setRecordingError, insertPracticeRunWithEvidence } from "./repository";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c1','t1',0,'S','x',1,'h');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e1','t1','c1','S',0,1,'x','h');
  `);
}

describe("recording repository", () => {
  it("insertRecording creates a row (stt_status defaults to none); setRecordingTranscript saves the transcript AND copies it to the linked practice_run", () => {
    const db = makeTestDb(); seed(db);
    const runId = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q", questionKind: "random" }, ["e1"]);
    const id = insertRecording(db, { thesisId: "t1", practiceRunId: runId, path: "recordings/a.webm", mime: "audio/webm", languageMode: "english", sttProvider: "google_cloud" });
    setRecordingTranscript(db, id, "  spoken answer  ");
    const rec = db.prepare("SELECT transcript, stt_status FROM recording WHERE id=?").get(id) as { transcript: string; stt_status: string };
    expect(rec).toMatchObject({ transcript: "spoken answer", stt_status: "ok" });
    expect((db.prepare("SELECT transcript FROM practice_run WHERE id=?").get(runId) as { transcript: string }).transcript).toBe("spoken answer");
    db.close();
  });
  it("setRecordingError marks the row error with the message", () => {
    const db = makeTestDb(); seed(db);
    const id = insertRecording(db, { thesisId: "t1", path: "recordings/b.webm", mime: "audio/webm", languageMode: "english", sttProvider: "google_cloud" });
    setRecordingError(db, id, "boom");
    expect(db.prepare("SELECT stt_status, stt_error FROM recording WHERE id=?").get(id)).toMatchObject({ stt_status: "error", stt_error: "boom" });
    db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — append to `src/db/repository.ts` (reuse `randomUUID`):

```ts
export type NewRecording = { thesisId: string; practiceRunId?: string; path: string; mime: string; durationMs?: number; languageMode: "english" | "chinese"; sttProvider: string };

export function insertRecording(db: DB, r: NewRecording): string {
  // Same-thesis guard: a linked practice_run must belong to the recording's thesis,
  // so a transcript can never be copied across theses by setRecordingTranscript.
  if (r.practiceRunId) {
    const owned = db.prepare("SELECT 1 FROM practice_run WHERE id=? AND thesis_id=?").get(r.practiceRunId, r.thesisId);
    if (!owned) throw new Error(`practice_run ${r.practiceRunId} is not in thesis ${r.thesisId}`);
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO recording (id, thesis_id, practice_run_id, path, mime, duration_ms, language_mode, stt_provider)
     VALUES (@id, @thesis_id, @practice_run_id, @path, @mime, @duration_ms, @language_mode, @stt_provider)`,
  ).run({
    id, thesis_id: r.thesisId, practice_run_id: r.practiceRunId ?? null, path: r.path, mime: r.mime,
    duration_ms: r.durationMs ?? null, language_mode: r.languageMode, stt_provider: r.sttProvider,
  });
  return id;
}

export function setRecordingTranscript(db: DB, recordingId: string, transcript: string): void {
  const text = transcript.trim();
  const tx = db.transaction(() => {
    db.prepare("UPDATE recording SET transcript=?, stt_status='ok', stt_error=NULL WHERE id=?").run(text, recordingId);
    const row = db.prepare("SELECT practice_run_id FROM recording WHERE id=?").get(recordingId) as { practice_run_id: string | null } | undefined;
    if (row?.practice_run_id) db.prepare("UPDATE practice_run SET transcript=? WHERE id=?").run(text, row.practice_run_id);
  });
  tx();
}

export function setRecordingError(db: DB, recordingId: string, error: string): void {
  db.prepare("UPDATE recording SET stt_status='error', stt_error=? WHERE id=?").run(error, recordingId);
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(m5a): recording repository helpers (insert + transcript->practice_run + error) (Task 4)"`

---

### Task 5: `transcribeRecording` service (graceful, transport-injected)

**Files:** Create `src/lib/stt/transcribe.ts`, `src/lib/stt/transcribe.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/stt/transcribe.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/db";
import { MockSttTransport } from "./mock";
import { transcribeRecording } from "./transcribe";
import { insertRecording, insertPracticeRunWithEvidence } from "../../db/repository";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c1','t1',0,'S','x',1,'h');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e1','t1','c1','S',0,1,'x','h');
  `);
}

describe("transcribeRecording", () => {
  it("transcribes via the transport and saves it to the recording + practice_run", async () => {
    const db = makeTestDb(); seed(db);
    const runId = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q", questionKind: "random" }, ["e1"]);
    const id = insertRecording(db, { thesisId: "t1", practiceRunId: runId, path: "r/a.webm", mime: "audio/webm", languageMode: "english", sttProvider: "google_cloud" });
    const res = await transcribeRecording(db, new MockSttTransport("hello viva"), { recordingId: id, audio: new Uint8Array([1]) });
    expect(res).toEqual({ status: "ok", transcript: "hello viva" });
    expect((db.prepare("SELECT transcript FROM practice_run WHERE id=?").get(runId) as { transcript: string }).transcript).toBe("hello viva");
    db.close();
  });
  it("skips (no throw) when the transport is disabled", async () => {
    const db = makeTestDb(); seed(db);
    const id = insertRecording(db, { thesisId: "t1", path: "r/b.webm", mime: "audio/webm", languageMode: "english", sttProvider: "off" });
    const disabled = { enabled: false, transcribe: () => Promise.reject(new Error("disabled")) };
    const res = await transcribeRecording(db, disabled, { recordingId: id, audio: new Uint8Array([1]) });
    expect(res.status).toBe("skipped");
    expect((db.prepare("SELECT stt_status FROM recording WHERE id=?").get(id) as { stt_status: string }).stt_status).toBe("none");
    db.close();
  });
  it("marks the recording error (no throw) when the transport throws", async () => {
    const db = makeTestDb(); seed(db);
    const id = insertRecording(db, { thesisId: "t1", path: "r/c.webm", mime: "audio/webm", languageMode: "english", sttProvider: "google_cloud" });
    const boom = { enabled: true, transcribe: () => Promise.reject(new Error("api down")) };
    const res = await transcribeRecording(db, boom, { recordingId: id, audio: new Uint8Array([1]) });
    expect(res.status).toBe("error");
    expect(db.prepare("SELECT stt_status, stt_error FROM recording WHERE id=?").get(id)).toMatchObject({ stt_status: "error", stt_error: "api down" });
    db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/stt/transcribe.ts
import "server-only";
import type { Database as DB } from "better-sqlite3";
import type { SttTransport } from "./types";
import { setRecordingTranscript, setRecordingError } from "../../db/repository";

export async function transcribeRecording(
  db: DB,
  stt: SttTransport,
  args: { recordingId: string; audio: Uint8Array },
): Promise<{ status: "ok" | "skipped" | "error"; transcript?: string }> {
  if (!stt.enabled) return { status: "skipped" }; // recording stays stt_status='none' until a real provider runs

  const rec = db.prepare("SELECT mime, language_mode FROM recording WHERE id=?").get(args.recordingId) as
    | { mime: string; language_mode: "english" | "chinese" }
    | undefined;
  if (!rec) return { status: "error" };

  try {
    const { transcript } = await stt.transcribe(args.audio, { mime: rec.mime, languageMode: rec.language_mode });
    setRecordingTranscript(db, args.recordingId, transcript);
    return { status: "ok", transcript };
  } catch (e) {
    setRecordingError(db, args.recordingId, e instanceof Error ? e.message : String(e));
    return { status: "error" };
  }
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (3).
- [ ] **Step 5: Commit** — `git commit -m "feat(m5a): transcribeRecording service (graceful, transport-injected) (Task 5)"`

---

## Full-suite gate (Claude runs)

```bash
npm run check   # typecheck + lint + vitest (all new stt/recording/config tests)
npm run build   # server-only imports (stt + repository) must not crash the build
```
Expected: gate green; test count = previous (150) + config (1) + index (3) + google (2) + recording (2) + transcribe (3) ≈ 161 + 2 skipped. Typed casts in tests, never `as any`. (No dev smoke — there is no UI/route in M5a; M5b adds the browser flow + a manual mic smoke.)

## Red-line / safety checklist

1. **Local-first / optional outbound (red line #3):** server STT is OFF unless `STT_PROVIDER=google_cloud` AND `GOOGLE_STT_API_KEY` is set; `getSttTransport` returns a disabled transport otherwise. The only network call is `googleSttTransport` → GCP, gated by that config; the §3 privacy disclosure (M4d) already states audio goes to Google Cloud in that mode.
2. **Graceful degrade (red line #4):** `transcribeRecording` never throws into a caller — disabled → `skipped`, provider error → `stt_status='error'` + returned `error`. The app stays usable with STT off (typed answers still work).
3. **STT via the unified layer (red line #2-analogue):** all transcription goes through `SttTransport`; no provider SDK scattered; the key lives only in env (`process.env.GOOGLE_STT_API_KEY`), never hardcoded or sent to the client.
4. **Tests never hit a real provider (red line #5):** `MockSttTransport` + a stubbed `fetch`; no live GCP call in the suite.
5. **Transcript feeds the existing evidence-grounded judge unchanged:** `setRecordingTranscript` copies onto `practice_run.transcript`, which `runJudge` already consumes via `answer_text || transcript` — no judge change, grounding intact.

## Self-review

- **Spec coverage:** §12 STT + recordings → the `recording` row lifecycle (pending → ok/error), provider-agnostic transport, google_cloud opt-in, transcript→practice_run. The `browser` provider + audio capture UI + file storage on disk are M5b (this slice stores a `path` string but does not write files — M5b's upload action does).
- **Type consistency:** `SttOpts.languageMode` matches `recording.language_mode` CHECK (`english|chinese`); `Config.sttConfigured` mirrors `gatewayConfigured`'s shape; `transcribeRecording` takes an injected `SttTransport` (mock in tests, `getSttTransport(config)` in M5b).
- **Testable surface:** 100% unit-tested (config, gating, the GCP transport via stubbed fetch, recording lifecycle, the service's ok/skipped/error paths). No browser code in M5a.
- **No placeholders:** full code for every file.
- **Open question for Codex review:** is the GCP Speech v1 `recognize` request shape correct (encoding from mime, `languageCode`, base64 `audio.content`), or should sync-recognize be swapped for long-running recognition for >1 min audio (a documented later refinement)? (Resolved: `insertRecording` leaves `stt_status='none'`; `transcribeRecording` sets `ok`/`error` and the disabled path skips, staying `none` — a `pending` UI state belongs to M5b's upload action.)
