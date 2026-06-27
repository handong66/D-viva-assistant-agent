# Feature 2 — Graceful Google STT length limit + browser-path guidance

> **老流程:** Codex implements; Claude runs the gate + reviews + commits, with a Codex design review before code and a milestone gate after. (Touches the optional outbound STT call — gets a milestone gate.) **Redesigned after design round 1 + a user decision (Option B).**

**Why (round-1 finding):** Google Speech-to-Text v1 caps SYNC `speech:recognize` at ~60 seconds, and `longrunningrecognize` with INLINE base64 audio has the same ~60s limit — audio longer than a minute must live in Cloud Storage (`audio.uri = gs://…`). A GCS-backed path would require a service-account credential, a bucket + upload/cleanup, and temporarily storing the user's audio in cloud storage — all of which break this app's local-first, API-key-only, zero-cloud-storage design. **User chose Option B:** keep the Google path at ≤~1 minute, and when an answer exceeds it, fail with a **clear, actionable message** pointing to the already-shipped **browser STT path** (`STT_PROVIDER=browser`, Web Speech continuous recognition), which has no fixed length limit and needs no key.

**Goal:** (1) When Google rejects an over-length recording, surface a specific, helpful error ("over ~1 minute — shorten it or use browser speech") instead of a generic failure; (2) proactively disclose the ~1-minute Google limit on `/library` so the user knows up front. No new infrastructure, no new outbound surface.

**Architecture:** `lib/stt/google.ts` recognises Google's "sync input too long" 400 and throws a typed `SttTooLongError` with a friendly message. The existing error path (`transcribeRecording` → `setRecordingError` → action) is extended to **thread the error message to the UI** (previously generic). `/library`'s STT disclosure gains a one-line length note. The sync `recognize` call, the fail-closed key guard, the `AbortSignal.timeout`, and the empty-transcript→error handling are all unchanged.

**Tech Stack:** fetch, vitest (`vi.stubGlobal`). No new deps, no schema change, no cloud storage.

---

### Task 1: detect "too long" in `lib/stt/google.ts`

**Files:** Modify `src/lib/stt/types.ts` (add `SttTooLongError`), `src/lib/stt/google.ts`, `src/lib/stt/google.test.ts`

- [ ] **Step 1: Add the typed error** — in `src/lib/stt/types.ts` (next to the existing `SttDisabledError`):
```ts
export class SttTooLongError extends Error {
  constructor() {
    super("This recording is over Google Cloud's ~1-minute limit. Keep your answer under a minute, or set STT_PROVIDER=browser, which uses your browser's continuous speech recognition (no app key, and not subject to this ~1-minute limit).");
    this.name = "SttTooLongError";
  }
}
```

- [ ] **Step 2: Failing test** (`src/lib/stt/google.test.ts`) — a 400 whose body marks the length limit → `SttTooLongError`; a generic 400 → the existing status error:
```ts
it("throws a clear SttTooLongError when Google reports the sync length limit", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Sync input too long. For audio longer than 1 min use LongRunningRecognize with a 'uri' parameter." } }), { status: 400 })));
  process.env.GOOGLE_STT_API_KEY = "k";
  await expect(googleSttTransport().transcribe(Buffer.from([1]), { mime: "audio/webm", languageMode: "english" })).rejects.toBeInstanceOf(SttTooLongError);
});
it("throws the generic status error for a non-length 400", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid encoding" } }), { status: 400 })));
  process.env.GOOGLE_STT_API_KEY = "k";
  await expect(googleSttTransport().transcribe(Buffer.from([1]), { mime: "audio/webm", languageMode: "english" })).rejects.toThrow(/400/);
});
```
(Keep the existing happy-path + opusEncoding tests.)

- [ ] **Step 3: Implement** — in `src/lib/stt/google.ts`, on a non-OK response read the body once and branch:
```ts
if (!response.ok) {
  const detail = await response.text().catch(() => "");
  if (response.status === 400 && /too long|longer than|longrunningrecognize|use .{0,3}uri/i.test(detail)) {
    throw new SttTooLongError();
  }
  throw new Error(`Google STT request failed with status ${response.status}`);
}
```
(Everything else — `config`, the fail-closed key guard, `AbortSignal.timeout`, the empty→ handling upstream — unchanged.)

- [ ] **Step 4: PASS + typecheck**, commit — `git commit -m "feat(f2): detect Google STT over-length (SttTooLongError) for a clear hint"`

---

### Task 2: thread the error message to the UI + disclose the limit

**Files:** Modify `src/lib/stt/transcribe.ts`, `src/app/_actions/recording.ts`, `src/app/library/page.tsx` (+ `src/lib/stt/transcribe.test.ts`)

- [ ] **Step 1: Thread the message** — `transcribeRecording` returns the failure message so the UI can show the specific reason (this also delivers the earlier-deferred message threading):
  - Change the error variant of its return type to `{ status: "error"; message: string }`.
  - Populate `message` in **EVERY** `{status:"error"}` branch — none may return without one: the recording-not-found branch (`"Recording not found."`), the empty-transcript branch (`"No speech was recognized in the recording."`), and the catch branch (`err instanceof Error ? err.message : String(err)` — which carries the `SttTooLongError` text). These are the same strings already passed to `setRecordingError`.

- [ ] **Step 2: Surface it in the action** — `RecordState` already carries `{ error: string | null }` and `src/app/practice/answer-form.tsx` displays `res.error` directly, so there is **NO shape change**. In `src/app/_actions/recording.ts` (`transcribeAnswerAction`), when `transcribeRecording` returns `status:"error"`, set `error: result.message` (every error branch now has one), replacing the current collapse-to-generic-message.

- [ ] **Step 3: Disclose the limit** — in `src/app/library/page.tsx`, append to the `google_cloud` STT disclosure branch: " Answers over ~1 minute aren't supported here — use browser speech (STT_PROVIDER=browser) for longer answers." (Keep the existing "sent to Google Cloud" wording.)

- [ ] **Step 4: Test** (`src/lib/stt/transcribe.test.ts`) — a transport that throws `SttTooLongError` → `transcribeRecording` returns `{ status:"error", message: <the SttTooLongError text> }` and the recording row's `stt_status='error'` with that message. (Extend the existing empty→error test to also assert its message.)

- [ ] **Step 5: PASS + typecheck + build**, commit — `git commit -m "feat(f2): surface the over-length STT message to the UI + disclose the Google ~1-min limit"`

---

## Gate + smoke (Claude)

```bash
npm run check   # google over-length detection + transcribe message-threading + existing suite
npm run build   # /library + /practice compile
```
Dev smoke (AI off, STT_PROVIDER=google_cloud + a dummy key): `/library` shows the Google disclosure WITH the new ~1-minute note. (The actual over-length error needs a real >1-min recording + key — covered by the fetch-mock unit tests; the browser path already handles long answers and is the documented alternative.)

## Red lines

1. **Local-first preserved (#3):** no Cloud Storage, no new credential, no new outbound surface — the audio still goes only to Google's Speech-to-Text endpoint when configured. We just fail clearly when Google's own limit is hit and point to the browser path (continuous Web Speech recognition, no app key — note: NOT local; the browser may send audio to its vendor, as `/library` already discloses for the `browser` provider).
2. **Graceful degrade + honesty (#4):** an over-length answer now yields a specific, actionable message (not a silent/blank or opaque failure); the fail-closed key guard, disabled/skip, and empty→error paths are unchanged.
3. **No fabrication / no AI change:** STT only; no LLM, no validator, no evidence-binding touched.

## Self-review

- **Honest about the limit:** rather than pretending inline-longrunning solves long audio (it doesn't), we detect Google's real limit, tell the user precisely, and route them to the browser path that genuinely handles long continuous answers with no key.
- **Reuses the existing error path:** `SttTooLongError` flows through the same `transcribeRecording` try/catch; the only addition is threading its message to the form (which also closes the earlier-deferred generic-message gap).
- **Detection robustness:** the 400-body regex matches Google's "Sync input too long … LongRunningRecognize … 'uri'" message; any other 400 stays the generic status error (no false "too long" on a config error).
- **Open question for Codex review:** is matching the 400 body text acceptable (vs a size pre-check, which is unreliable for variable-bitrate Opus)? And is threading `message` through `transcribeRecording`'s return the right place to surface it (vs reading the recording row in the action)?
