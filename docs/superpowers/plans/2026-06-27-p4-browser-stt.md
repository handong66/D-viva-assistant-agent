# Polish P4 — Browser speech-to-text (Web Speech API)

> **老流程:** Codex implements per task; Claude runs the gate + reviews + commits, with a Codex design review before code and a milestone gate after. (Polish item — the client `SpeechRecognition` path is untestable headlessly, like M5b; verified by typecheck + build + read + a manual mic test by the human.)

**Goal:** Make voice answers work with **zero configuration** — when `STT_PROVIDER=browser`, the mic button uses the browser's built-in `SpeechRecognition` (Web Speech API) to transcribe speech directly into the answer box. No GCP key, no audio file, no audio through our server. This unblocks trying voice answers without the Google Cloud path (M5b).

**Architecture:** A pure `sttUiMode(config)` resolves the config to the UI mode (`off` / `browser` / `google_cloud`, where `google_cloud` without a key degrades to `off`). The practice page passes that mode to `AnswerForm`, which branches: `google_cloud` → the existing MediaRecorder→`transcribeAnswerAction` (server, GCP); `browser` → `SpeechRecognition` (client-only, fills the textarea live); `off` → no mic. The `/library` disclosure is corrected to honestly describe the browser path (it may send audio to the browser vendor).

**Tech Stack:** Web Speech API (`window.SpeechRecognition` / `webkitSpeechRecognition`, client-only), React client component, Next 16 RSC (practice page), Tailwind, vitest (the pure helper only).

> **Scope:** the `browser` provider path + the honest disclosure. NOT in scope: persisting browser transcripts as `recording` rows (browser STT produces text only — there's no audio file to store; the typed/edited transcript flows through the normal `submitAnswerAction`), choosing recognition language in the UI (default `en-US`; configurable later), on-device-only guarantees (the browser decides whether it uses a cloud service).

---

## Contracts

```ts
// src/lib/stt/mode.ts
export type SttUiMode = "off" | "browser" | "google_cloud";
export function sttUiMode(c: { sttProvider: "off" | "browser" | "google_cloud"; sttConfigured: boolean }): SttUiMode;

// src/app/practice/answer-form.tsx — prop change
export function AnswerForm({ runId, sttMode }: { runId: string; sttMode: SttUiMode }): JSX.Element;
```

## File structure

- **Create** `src/lib/stt/mode.ts` (+`src/lib/stt/mode.test.ts`) — `sttUiMode`.
- **Modify** `src/app/library/page.tsx` — honest `browser` disclosure wording.
- **Modify** `src/app/practice/answer-form.tsx` — `sttMode` prop + the `SpeechRecognition` branch.
- **Modify** `src/app/practice/page.tsx` — compute `sttUiMode`, pass `sttMode`.

---

### Task 1: `sttUiMode` helper + honest browser disclosure

**Files:** Create `src/lib/stt/mode.ts` + `src/lib/stt/mode.test.ts`, Modify `src/app/library/page.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/stt/mode.test.ts
import { describe, it, expect } from "vitest";
import { sttUiMode } from "./mode";

describe("sttUiMode", () => {
  it("google_cloud only when configured, else off (no key → can't record)", () => {
    expect(sttUiMode({ sttProvider: "google_cloud", sttConfigured: true })).toBe("google_cloud");
    expect(sttUiMode({ sttProvider: "google_cloud", sttConfigured: false })).toBe("off");
  });
  it("browser needs no key; off stays off", () => {
    expect(sttUiMode({ sttProvider: "browser", sttConfigured: false })).toBe("browser");
    expect(sttUiMode({ sttProvider: "off", sttConfigured: false })).toBe("off");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `src/lib/stt/mode.ts`:

```ts
export type SttUiMode = "off" | "browser" | "google_cloud";

/** Resolve config to the answer-form's STT mode. google_cloud without a key can't record → off.
 *  browser needs no key. Pure — the practice page calls it server-side and passes the string to the client form. */
export function sttUiMode(c: { sttProvider: "off" | "browser" | "google_cloud"; sttConfigured: boolean }): SttUiMode {
  if (c.sttProvider === "google_cloud") return c.sttConfigured ? "google_cloud" : "off";
  return c.sttProvider; // "off" | "browser"
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (2).

- [ ] **Step 5: Honest browser disclosure** — in `src/app/library/page.tsx`, replace the `browser` branch (currently "audio is transcribed locally by your browser") with an honest version:

```tsx
config.sttProvider === "off"
  ? "off — no audio is captured or sent."
  : config.sttProvider === "browser"
    ? "browser — your browser's built-in speech recognition transcribes your voice. Depending on the browser, audio may be sent to the browser vendor's service (e.g. Google for Chrome). No audio passes through this app and no API key is used."
    : "Google Cloud — recorded audio is sent to Google Cloud Speech-to-Text for transcription."
```

> The "nothing leaves your machine" line (gated on `sttProvider === "off"`) is already correct — it does not claim that for `browser`.

- [ ] **Step 6: Commit** — `git commit -m "feat(p4): sttUiMode helper + honest browser STT disclosure"`

---

### Task 2: `SpeechRecognition` branch in AnswerForm

**Files:** Modify `src/app/practice/answer-form.tsx`, `src/app/practice/page.tsx`

- [ ] **Step 1: Practice page** — in `src/app/practice/page.tsx`: `import { sttUiMode } from "../../lib/stt/mode";`, replace the `sttReady` const with `const sttMode = sttUiMode(config);`, and pass `<AnswerForm runId={run.id} sttMode={sttMode} />`.

- [ ] **Step 2: AnswerForm** — change the prop to `sttMode` and add the browser path. The existing cloud `start`/`stop` become `startCloud`/`stopCloud`; `start`/`stop` dispatch on `sttMode`. Minimal local types keep it `any`-free:

```tsx
"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { submitAnswerAction } from "../_actions/practice";
import { transcribeAnswerAction } from "../_actions/recording";
import type { SttUiMode } from "../../lib/stt/mode";

const MAX_CLIENT_BYTES = 10 * 1024 * 1024;
const OPUS_MIMES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"];

// Minimal Web Speech API shape (not in the TS DOM lib) — no `any`.
type SpeechRecognitionAlternative = { transcript: string };
type SpeechRecognitionResultLike = { isFinal: boolean; 0: SpeechRecognitionAlternative };
type SpeechRecognitionEventLike = { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionLike = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function AnswerForm({ runId, sttMode }: { runId: string; sttMode: SttUiMode }) {
  const [state, action, pending] = useActionState(submitAnswerAction, { error: null });
  const [answer, setAnswer] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");   // answer text when browser recording began
  const finalRef = useRef("");  // accumulated final transcript this session

  // Stop any active capture if the form unmounts (navigating away mid-recording);
  // detach the recognition callbacks first so none fire after unmount.
  useEffect(() => () => {
    const rec = recognitionRef.current;
    if (rec) { rec.onresult = null; rec.onerror = null; rec.onend = null; rec.stop(); recognitionRef.current = null; }
    recorderRef.current?.stop();
  }, []);

  async function startCloud() {
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
  function stopCloud() { recorderRef.current?.stop(); setRecording(false); }

  function startBrowser() {
    setRecError(null);
    const Ctor = (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor });
    const SR = Ctor.SpeechRecognition ?? Ctor.webkitSpeechRecognition;
    if (!SR) { setRecError("Speech recognition isn't supported in this browser — type your answer instead."); return; }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    baseRef.current = answer ? answer + " " : "";
    finalRef.current = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      setAnswer(baseRef.current + finalRef.current + interim);
    };
    rec.onerror = (ev) => { setRecError(`Speech recognition error${ev.error ? `: ${ev.error}` : ""}.`); setRecording(false); };
    rec.onend = () => { setRecording(false); recognitionRef.current = null; };
    try { rec.start(); recognitionRef.current = rec; setRecording(true); }
    catch { setRecError("Could not start speech recognition."); }
  }
  function stopBrowser() { recognitionRef.current?.stop(); setRecording(false); }

  const start = () => (sttMode === "browser" ? startBrowser() : startCloud());
  const stop = () => (sttMode === "browser" ? stopBrowser() : stopCloud());

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="practiceRunId" value={runId} />

      {sttMode !== "off" ? (
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
        placeholder={sttMode !== "off" ? "Type your answer — or record above and edit the transcript…" : "Type your answer…"}
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

- [ ] **Step 3: Typecheck + build** — `npx tsc --noEmit` (exit 0). (Claude runs `npm run build`.)
- [ ] **Step 4: Commit** — `git commit -m "feat(p4): browser SpeechRecognition answer path"`

---

## Gate + smoke (Claude) + manual (human)

```bash
npm run check   # sttUiMode tests
npm run build   # /practice + /library compile
```
Dev smoke (Claude, AI off): with `STT_PROVIDER=browser`, `/library` shows the honest browser disclosure and the "nothing leaves" line is absent; `/practice` renders the answer form with the mic button present (the `SpeechRecognition` behavior itself can't be headless-tested). With `STT_PROVIDER=off`, no mic button. **Manual (human):** in Chrome with `STT_PROVIDER=browser`, Practice → generate a question → 🎤 Record → speak → the textarea fills live → Stop → edit → Submit → judged. No `recording` row is written (browser path stores no audio).

## Red lines

1. **Local-first + honest disclosure (red line #3):** the browser path sends NO audio through our app and needs no key; but because the browser itself may use a cloud service, `/library` now says so plainly ("audio may be sent to the browser vendor's service"). The "nothing leaves your machine" claim stays gated on `sttProvider === "off"` only.
2. **Graceful degrade (red line #4):** `SpeechRecognition` missing → a clear "not supported — type your answer" message; the textarea + submit always work. `google_cloud` without a key → `sttUiMode` returns `off` (no broken mic).
3. **No new outbound from us:** no server action, no audio file, no `recording` row for the browser path — it's pure client text that flows through the existing `submitAnswerAction`. No AI/LLM change.
4. **No `any`:** the Web Speech API is typed with a minimal local interface + a single `as unknown as` window cast (lint `no-explicit-any` clean).

## Self-review

- **Reuse:** the cloud path (MediaRecorder → `transcribeAnswerAction`) is unchanged — only renamed to `startCloud`/`stopCloud` and gated behind `sttMode === "google_cloud"`. The browser path is additive.
- **Testable vs not:** `sttUiMode` is pure and unit-tested; the `/library` disclosure is RSC (smoke-able). The `SpeechRecognition` client code is inherently un-headless-testable (like M5b's MediaRecorder) → typecheck + build + read + a documented manual mic test.
- **Type consistency:** `SttUiMode` is shared by `sttUiMode`, the practice page, and `AnswerForm`'s prop; the interim/final accumulation uses refs so the controlled textarea stays user-editable after recording.
- **Round-1 review fix:** added a `useEffect` unmount cleanup (detach the recognition callbacks → `stop()` → null the ref; also stop the recorder) so navigating away mid-recording can't leave `SpeechRecognition` running or fire `setAnswer`/`setRecError` after unmount; `onend` also nulls the ref.
- **Open question for Codex review:** default recognition language `en-US` — acceptable for v1 (viva answers are in English), or should it follow a config/`languageMode`? (Deferred: the cloud path's `languageMode` isn't surfaced in the form either.) Also: is `as unknown as { SpeechRecognition?... }` the cleanest no-`any` access, or prefer a `declare global` Window augmentation?
