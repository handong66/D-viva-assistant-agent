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
