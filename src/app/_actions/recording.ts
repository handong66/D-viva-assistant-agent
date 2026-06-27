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
  try {
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
    // Defense-in-depth: the client locks Opus, but a direct action call could send anything.
    if (!/^audio\/(webm|ogg|wav)\b/.test(file.type)) return { transcript: null, error: "Unsupported audio format." };

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
