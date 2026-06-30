"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { submitAnswerAction } from "../_actions/practice";
import { transcribeAnswerAction } from "../_actions/recording";
import type { SttUiMode } from "../../lib/stt/mode";
import { getUiCopy, type UiLocale } from "../../lib/ui-copy";

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

export function AnswerForm({ runId, sttMode, locale }: { runId: string; sttMode: SttUiMode; locale: UiLocale }) {
  const t = getUiCopy(locale).practice;
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
    if (!mime) { setRecError(t.recordUnsupported); return; }
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
        if (blob.size === 0) { setRecError(t.noAudio); return; }
        if (blob.size > MAX_CLIENT_BYTES) { setRecError(t.tooLong); return; }
        setBusy(true);
        try {
          const fd = new FormData();
          fd.set("audio", blob, "answer");
          fd.set("practiceRunId", runId);
          const res = await transcribeAnswerAction(fd);
          if (res.error) setRecError(res.error);
          else if (res.transcript) setAnswer((prev) => (prev ? prev + " " : "") + res.transcript);
        } catch {
          setRecError(t.transcribeFail);
        } finally {
          setBusy(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setRecError(t.micFail);
    }
  }
  function stopCloud() { recorderRef.current?.stop(); setRecording(false); }

  function startBrowser() {
    setRecError(null);
    const Ctor = (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor });
    const SR = Ctor.SpeechRecognition ?? Ctor.webkitSpeechRecognition;
    if (!SR) { setRecError(t.speechUnsupported); return; }
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
    rec.onerror = (ev) => { if (recognitionRef.current !== rec) return; setRecError(t.speechError(ev.error)); setRecording(false); };
    rec.onend = () => { if (recognitionRef.current !== rec) return; setRecording(false); recognitionRef.current = null; };
    recognitionRef.current = rec;                  // set before start so callbacks see the current recognizer
    try { rec.start(); setRecording(true); }
    catch { recognitionRef.current = null; setRecError(t.speechStartFail); }
  }
  function stopBrowser() { recognitionRef.current?.stop(); setRecording(false); }

  const start = () => (sttMode === "browser" ? startBrowser() : startCloud());
  const stop = () => (sttMode === "browser" ? stopBrowser() : stopCloud());

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="practiceRunId" value={runId} />

      {sttMode !== "off" ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={recording ? stop : start} disabled={busy} className="btn-secondary min-h-0 px-3 py-1.5 disabled:opacity-50">
            {recording ? t.stop : busy ? t.transcribing : t.record}
          </button>
          {recError ? <span className="text-sm text-[#c0263d]">{recError}</span> : null}
        </div>
      ) : null}

      <textarea
        name="answer"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={8}
        required
        placeholder={sttMode !== "off" ? t.answerPlaceholderStt : t.answerPlaceholder}
        className="field"
      />
      <button type="submit" disabled={pending} className="btn-primary self-start disabled:opacity-50">
        {pending ? t.scoring : t.submit}
      </button>
      {state.error ? <p className="text-sm text-[#c0263d]">{state.error}</p> : null}
    </form>
  );
}
