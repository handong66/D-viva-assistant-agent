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
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");   // answer text when browser recording began
  const finalRef = useRef("");  // accumulated final transcript this session

  // Stop any active capture if the form unmounts (navigating away mid-recording);
  // detach the recognition callbacks first so none fire after unmount.
  useEffect(() => () => {
    const rec = recognitionRef.current;
    if (rec) { rec.onresult = null; rec.onerror = null; rec.onend = null; rec.stop(); recognitionRef.current = null; }
    const recorder = recorderRef.current;
    if (recorder) { recorder.onstop = null; recorder.ondataavailable = null; if (recorder.state !== "inactive") recorder.stop(); recorderRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  async function startCloud() {
    setRecError(null);
    const mime = OPUS_MIMES.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
    if (!mime) { setRecError("Recording is not supported in this browser — type your answer instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
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
      if (recognitionRef.current !== rec) return; // ignore a superseded recognizer's late event
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      setAnswer(baseRef.current + finalRef.current + interim);
    };
    rec.onerror = (ev) => { if (recognitionRef.current !== rec) return; setRecError(`Speech recognition error${ev.error ? `: ${ev.error}` : ""}.`); setRecording(false); };
    rec.onend = () => { if (recognitionRef.current !== rec) return; setRecording(false); recognitionRef.current = null; };
    recognitionRef.current = rec;                  // set before start so callbacks see the current recognizer
    try { rec.start(); setRecording(true); }
    catch { recognitionRef.current = null; setRecError("Could not start speech recognition."); }
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
