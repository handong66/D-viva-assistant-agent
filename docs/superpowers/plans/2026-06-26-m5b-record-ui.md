# M5b — Browser Record UI (voice answers) Implementation Plan

> **For agentic workers:** This project runs the Claude↔Codex 老流程 (see `AGENTS.md`): **Codex implements** each task; **Claude runs tests + reviews + commits** per task and at a milestone gate. Steps use checkbox (`- [ ]`) syntax.

> **⚠️ Verification caveat (read first):** this slice is browser + microphone code (`MediaRecorder`, `getUserMedia`). It CANNOT be unit-tested or headless-smoked. Verification = the one pure helper's unit test + `npx tsc --noEmit` + `next build` + Codex review of the wiring + a **manual mic smoke the human runs** (record → transcript appears → submit → judged). Only `recordingPath` is unit-tested; the action + the client component are build/review/manual-verified.

**Goal:** Let a user answer a practice question by voice (spec §7 ⑤, §12). A "🎤 Record" control on the practice answer form captures audio, uploads it to a Server Action that saves it under `recordings/` and runs the M5a `transcribeRecording` (google_cloud), and drops the transcript into the answer box for review/edit/submit. Completes M5.

**Architecture:** The google_cloud upload path, reusing all of M5a unchanged. The record control lives inside the existing `AnswerForm` (M4c) so the transcript fills the same `answer` textarea that `submitAnswerAction` already reads — no new submit path, no judge change. The control is shown only when STT is configured (`sttProvider==='google_cloud' && sttConfigured`), passed from the server page; otherwise typed answers work exactly as before (graceful degrade). The `browser` Web Speech path (client-side `SpeechRecognition`, no upload/file) is a documented later alternative.

**Tech Stack:** Next 16 Server Actions (imperatively called from a client handler), React 19 client component, `MediaRecorder`/`getUserMedia` (works on localhost/HTTPS), `node:fs/promises` (writes to the gitignored `recordings/`), better-sqlite3, vitest. Reuses M5a's `getSttTransport`/`transcribeRecording`/`insertRecording`.

> **v1 scope notes:** google_cloud path only; `browser` Web Speech deferred. Audio language is `english` (the recording's `language_mode` default) — a per-recording language picker is later. Recordings are bounded by the Server Action body limit (15 MB, set in M4a) → short answers; long-running recognition for big files is deferred (M5a note). `getUserMedia` needs localhost or HTTPS.

> **Revised after Codex design-review round 1** (CONDITIONAL GO → fixes integrated): **P1** the imperative `await transcribeAnswerAction(fd)` is now wrapped in `try/catch/finally` (busy always cleared, friendly error on a 413/throw) with a 10 MB client-side pre-check before the 15 MB server backstop. **P2** the recorder locks an Opus MIME via `MediaRecorder.isTypeSupported` (`audio/webm;codecs=opus` / `audio/ogg;codecs=opus`) with a "not supported" fallback, so the audio always matches what the GCP transport handles. **P2** the write location resolves against `recordingsRoot()` (`RECORDINGS_DIR` env, default `cwd/recordings`) instead of a bare relative path; `recordingPath` now returns the stored sub-path `<date>/<id>.<ext>`.

---

## Contracts

```ts
// src/lib/stt/path.ts — pure
export function recordingPath(recordingId: string, mime: string): string; // "<date>/<id>.<ext>" relative to recordingsRoot()

// src/app/_actions/recording.ts — "use server"
export type RecordState = { transcript: string | null; error: string | null };
export async function transcribeAnswerAction(formData: FormData): Promise<RecordState>; // imperatively callable
```

## File structure

- **Create** `src/lib/stt/path.ts` (+`path.test.ts`) — the pure path/extension helper.
- **Create** `src/app/_actions/recording.ts` — `transcribeAnswerAction` (gated upload → save → M5a transcribe).
- **Modify** `src/app/practice/answer-form.tsx` — add the record control + a controlled `answer` textarea.
- **Modify** `src/app/practice/page.tsx` — compute `sttReady` and pass it to `<AnswerForm>`.

---

### Task 1: `recordingPath` pure helper

**Files:** Create `src/lib/stt/path.ts`, `src/lib/stt/path.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/stt/path.test.ts
import { describe, it, expect } from "vitest";
import { recordingPath } from "./path";

describe("recordingPath", () => {
  it("builds recordings/<date>/<id>.<ext>, mapping the MediaRecorder mime to an extension", () => {
    expect(recordingPath("abc", "audio/webm;codecs=opus")).toMatch(/^\d{4}-\d{2}-\d{2}\/abc\.webm$/);
    expect(recordingPath("def", "audio/ogg;codecs=opus")).toMatch(/^\d{4}-\d{2}-\d{2}\/def\.ogg$/);
    expect(recordingPath("ghi", "audio/wav")).toMatch(/\/ghi\.wav$/);
    expect(recordingPath("x", "application/octet-stream")).toMatch(/\/x\.bin$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/stt/path.test.ts` — FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/stt/path.ts
import { join } from "node:path";

/** Absolute root for stored recordings — deterministic even if CWD drifts. */
export function recordingsRoot(): string {
  return process.env.RECORDINGS_DIR ?? join(process.cwd(), "recordings");
}

function extFor(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "bin";
}

/** Path of a recording RELATIVE to recordingsRoot(): "<date>/<id>.<ext>" (stored as recording.path). */
export function recordingPath(recordingId: string, mime: string): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${date}/${recordingId}.${extFor(mime)}`;
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(m5b): recordingPath helper (Task 1)"`

---

### Task 2: `transcribeAnswerAction` server action

**Files:** Create `src/app/_actions/recording.ts`

No unit test (appContext + fs + getSttTransport; the STT core is M5a-unit-tested). Verified by typecheck + build + the manual smoke.

- [ ] **Step 1: Implement**

```ts
// src/app/_actions/recording.ts
"use server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appContext } from "../../lib/server/context";
import { getActiveThesis, insertRecording } from "../../db/repository";
import { getSttTransport } from "../../lib/stt";
import { transcribeRecording } from "../../lib/stt/transcribe";
import { recordingPath, recordingsRoot } from "../../lib/stt/path";

export type RecordState = { transcript: string | null; error: string | null };

const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // matches serverActions.bodySizeLimit

export async function transcribeAnswerAction(formData: FormData): Promise<RecordState> {
  const { db, config } = await appContext();
  const thesis = getActiveThesis(db);
  if (!thesis) return { transcript: null, error: "Import a thesis first." };
  if (!(config.sttProvider === "google_cloud" && config.sttConfigured)) {
    return { transcript: null, error: "Voice answers need google_cloud STT (set STT_PROVIDER=google_cloud and GOOGLE_STT_API_KEY)." };
  }

  // Bind the recording to the exact question shown, cross-checked to the active thesis.
  const runId = String(formData.get("practiceRunId") ?? "");
  const owned = db.prepare("SELECT id FROM practice_run WHERE id=? AND thesis_id=?").get(runId, thesis.id) as { id: string } | undefined;
  if (!owned) return { transcript: null, error: "That question is no longer available. Generate a new one." };

  const file = formData.get("audio");
  if (!(file instanceof File) || file.size === 0) return { transcript: null, error: "No audio was captured." };
  if (file.size > MAX_AUDIO_BYTES) return { transcript: null, error: "Recording is too large — keep answers under ~15 MB." };

  try {
    const audio = Buffer.from(await file.arrayBuffer());
    const recordingId = randomUUID();
    const rel = recordingPath(recordingId, file.type);     // "<date>/<id>.<ext>" (stored)
    const abs = join(recordingsRoot(), rel);                // resolved write location
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, audio);
    await insertRecording(db, {
      id: recordingId, thesisId: thesis.id, practiceRunId: owned.id,
      mimeType: file.type, languageMode: "english", audioPath: rel, sttProvider: "google_cloud",
    });
    const res = await transcribeRecording(db, getSttTransport(config), { recordingId, audio });
    if (res.status === "ok") return { transcript: res.transcript ?? "", error: null };
    return { transcript: null, error: "Could not transcribe the recording. Please try again." };
  } catch (error) {
    console.error("[transcribeAnswerAction]", error);
    return { transcript: null, error: "Could not process the recording. Please try again." };
  }
}
```

> Also add `RECORDINGS_DIR=` to `.env.example` (commented: absolute dir for stored audio; defaults to `./recordings` under the app's CWD, which is gitignored).

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` — exit 0.
- [ ] **Step 3: Commit** — `git commit -m "feat(m5b): transcribeAnswerAction (gated upload -> save -> transcribe) (Task 2)"`

---

### Task 3: Record control in the answer form + page wiring

**Files:** Modify `src/app/practice/answer-form.tsx`, `src/app/practice/page.tsx`

- [ ] **Step 1: Enhance the answer form**

```tsx
// src/app/practice/answer-form.tsx
"use client";
import { useActionState, useRef, useState } from "react";
import { submitAnswerAction } from "../_actions/practice";
import { transcribeAnswerAction } from "../_actions/recording";

const MAX_CLIENT_BYTES = 10 * 1024 * 1024; // pre-check before the 15 MB server limit
const OPUS_MIMES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"];

export function AnswerForm({ runId, sttReady }: { runId: string; sttReady: boolean }) {
  const [state, action, pending] = useActionState(submitAnswerAction, { error: null });
  const [answer, setAnswer] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function start() {
    setRecError(null);
    const mime = OPUS_MIMES.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
    if (!mime) { setRecError("Recording is not supported in this browser — type your answer instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        if (blob.size === 0) { setRecError("No audio was captured."); return; }
        if (blob.size > MAX_CLIENT_BYTES) { setRecError("Recording is too long — keep it under ~10 MB."); return; }
        setBusy(true);
        try {
          const fd = new FormData();
          fd.set("audio", blob, "answer");
          fd.set("practiceRunId", runId);
          const res = await transcribeAnswerAction(fd);
          if (res.error) setRecError(res.error);
          else if (res.transcript) setAnswer((prev) => (prev ? prev + " " : "") + res.transcript);
        } catch {
          setRecError("Could not transcribe the recording. Please try again.");
        } finally {
          setBusy(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setRecError("Could not access the microphone.");
    }
  }
  function stop() { recorderRef.current?.stop(); setRecording(false); }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="practiceRunId" value={runId} />

      {sttReady ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={recording ? stop : start} disabled={busy} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
            {recording ? "■ Stop" : busy ? "Transcribing…" : "🎤 Record answer"}
          </button>
          {recError ? <span className="text-sm text-red-600 dark:text-red-400">{recError}</span> : null}
        </div>
      ) : null}

      <textarea
        name="answer"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={8}
        required
        placeholder={sttReady ? "Type your answer — or record above and edit the transcript…" : "Type your answer…"}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button type="submit" disabled={pending} className="self-start rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950">
        {pending ? "Scoring…" : "Submit answer"}
      </button>
      {state.error ? <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p> : null}
    </form>
  );
}
```

> The controlled `<textarea name="answer" value={answer}>` still posts its current value in the form, so `submitAnswerAction` reads the (possibly recorded-then-edited) transcript unchanged. `transcribeAnswerAction` is invoked imperatively (`await transcribeAnswerAction(fd)`) from the `onstop` handler — a valid React 19 server-action call.

- [ ] **Step 2: Pass `sttReady` from the page** — in `src/app/practice/page.tsx`, read config and pass the prop:

```tsx
// in PracticePage, after `const { db } = await appContext();` change to:
const { db, config } = await appContext();
// ...
const sttReady = config.sttProvider === "google_cloud" && config.sttConfigured;
// ...
// where the unanswered branch renders the form:
<AnswerForm runId={run.id} sttReady={sttReady} />
```

- [ ] **Step 3: Typecheck + build** — `npx tsc --noEmit` (exit 0). (Claude runs `npm run build`.)
- [ ] **Step 4: Commit** — `git commit -m "feat(m5b): record control in the answer form + sttReady wiring (Task 3)"`

---

## Full-suite gate + verification (Claude runs what it can; the human runs the mic smoke)

```bash
npm run check   # typecheck + lint + vitest (incl. recordingPath)
npm run build   # Next prod build green (/practice still Dynamic)
```
- **Claude verifies:** gate green; build green; the record control is hidden when `sttReady` is false (typed answers unaffected) — confirmable by a headless `/practice` render with STT off (the 🎤 button must be absent).
- **Human verifies (manual mic smoke, google_cloud configured):** open `/practice`, generate a question, click 🎤 Record, speak, Stop → "Transcribing…" → the transcript appears in the textarea → edit if needed → Submit → judged; a file lands under `recordings/<date>/`; a `recording` row has the transcript + `stt_provider='google_cloud'`.

## Red-line / safety checklist

1. **Local-first / optional outbound (red line #3):** audio is uploaded to a Server Action on the same machine and written to the local `recordings/` (gitignored). It leaves the machine ONLY inside `transcribeRecording → googleSttTransport`, which is gated by `sttProvider==='google_cloud' && sttConfigured` AND fails closed without a key (M5a). The §3 disclosure (M4d) already states this.
2. **Graceful degrade (red line #4):** the record control renders only when STT is configured; otherwise the form is exactly the M4c typed-answer form. The action returns a friendly error (no throw) when STT is off or the run/audio is invalid.
3. **Answer binds to the shown question:** `transcribeAnswerAction` cross-checks the form `practiceRunId` against the active thesis (same guard as `submitAnswerAction`); the recording links to that run; `setRecordingTranscript` copies onto `practice_run.transcript` for the existing judge — grounding untouched.
4. **No secrets to the client:** the client posts an audio Blob + the run id; the STT key stays in the server action's `getSttTransport(config)`. The `"use client"` form imports only react + the two server actions.
5. **Bounded upload:** 15 MB cap (matches `serverActions.bodySizeLimit`); oversized/empty audio → friendly error.

## Self-review

- **Spec coverage:** §7 ⑤ record→STT→answer and §12 recording archive (file under `recordings/`, `recording` row, transcript→practice_run) → Tasks 2–3. `browser` Web Speech path + language picker + long-audio recognition are deferred (scope notes).
- **Type consistency:** `transcribeAnswerAction(formData): Promise<RecordState>` is single-arg (imperative call), distinct from `submitAnswerAction`'s `useActionState` 2-arg shape; the audio Buffer + M5a contracts (`insertRecording` caller-id/`mimeType`/`audioPath`/`sttProvider`, `transcribeRecording` Buffer) match what M5a shipped.
- **Testable surface:** only `recordingPath` is unit-tested; the action + the client component are typecheck + build + the human's manual mic smoke — inherent to browser audio (flagged up top).
- **No placeholders:** full code for every file.
- **Open questions for Codex review:** (a) is calling the server action imperatively from `onstop` the right pattern vs a `<form>`+`useActionState` around the recorder? (b) should the recording's `language_mode` be selectable now, or is `english`-default acceptable for v1? (c) any issue writing to a relative `recordings/` path under the Next server's CWD (vs an absolute path from config)?
