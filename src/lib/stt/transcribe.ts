import "server-only";
import type { Database } from "better-sqlite3";
import * as recordingRepository from "../../db/repository";
import type { SttTransport } from "./types";

export async function transcribeRecording(
  db: Database,
  stt: SttTransport,
  opts: { recordingId: string; audio: Buffer },
): Promise<{ status: "ok"; transcript: string } | { status: "skipped" } | { status: "error" }> {
  if (!stt.enabled) return { status: "skipped" };

  try {
    const recording = db
      .prepare("SELECT mime AS mime_type, language_mode FROM recording WHERE id=?")
      .get(opts.recordingId) as
      | { mime_type: string; language_mode: "english" | "chinese" }
      | undefined;
    if (!recording) return { status: "error" };

    const result = await stt.transcribe(opts.audio, {
      mime: recording.mime_type,
      languageMode: recording.language_mode,
    });
    const transcript = result.transcript.trim();
    if (!transcript) {
      await recordingRepository.setRecordingError(db, opts.recordingId, "No speech was recognized in the recording.");
      return { status: "error" };
    }
    await recordingRepository.setRecordingTranscript(db, opts.recordingId, transcript);
    return { status: "ok", transcript };
  } catch (err) {
    try {
      await recordingRepository.setRecordingError(
        db,
        opts.recordingId,
        err instanceof Error ? err.message : String(err),
      );
    } catch {
      return { status: "error" };
    }
    return { status: "error" };
  }
}
