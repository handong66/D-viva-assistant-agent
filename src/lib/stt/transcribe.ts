import "server-only";
import type { Database } from "better-sqlite3";
import * as recordingRepository from "../../db/repository";
import type { SttTransport } from "./types";

export async function transcribeRecording(
  db: Database,
  stt: SttTransport,
  opts: { recordingId: string; audio: Buffer },
): Promise<{ status: "ok"; transcript: string } | { status: "skipped" } | { status: "error"; message: string }> {
  if (!stt.enabled) return { status: "skipped" };

  try {
    const recording = db
      .prepare("SELECT mime AS mime_type, language_mode FROM recording WHERE id=?")
      .get(opts.recordingId) as
      | { mime_type: string; language_mode: "english" | "chinese" }
      | undefined;
    if (!recording) return { status: "error", message: "Recording not found." };

    const result = await stt.transcribe(opts.audio, {
      mime: recording.mime_type,
      languageMode: recording.language_mode,
    });
    const transcript = result.transcript.trim();
    if (!transcript) {
      const message = "No speech was recognized in the recording.";
      await recordingRepository.setRecordingError(db, opts.recordingId, message);
      return { status: "error", message };
    }
    await recordingRepository.setRecordingTranscript(db, opts.recordingId, transcript);
    return { status: "ok", transcript };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await recordingRepository.setRecordingError(db, opts.recordingId, message);
    } catch {
      return { status: "error", message };
    }
    return { status: "error", message };
  }
}
