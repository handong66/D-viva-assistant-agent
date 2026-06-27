import { join, resolve } from "node:path";

/** Absolute root for stored recordings — deterministic even if CWD drifts.
 *  A blank/whitespace RECORDINGS_DIR (e.g. a copied `.env` with `RECORDINGS_DIR=`) is
 *  treated as unset, so recordings never escape the gitignored ./recordings default. */
export function recordingsRoot(): string {
  const root = process.env.RECORDINGS_DIR?.trim();
  return root ? resolve(root) : join(process.cwd(), "recordings");
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
