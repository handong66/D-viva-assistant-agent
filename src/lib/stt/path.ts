import { join } from "node:path";

/** Absolute root for stored recordings — deterministic even if CWD drifts. */
export function recordingsRoot(): string {
  return process.env.RECORDINGS_DIR ?? join(process.cwd(), "recordings");
}

export function extFor(mime: string): string {
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
