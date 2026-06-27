import { afterEach, describe, expect, it, vi } from "vitest";
import { insertPracticeRunWithEvidence, insertRecording } from "../../db/repository";
import * as recordingRepository from "../../db/repository";
import { makeTestDb } from "../../test/db";
import { MockSttTransport } from "./mock";
import { transcribeRecording } from "./transcribe";
import type { SttTransport } from "./types";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c1','t1',0,'S','x',1,'h');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e1','t1','c1','S',0,1,'x','h');
  `);
}

describe("transcribeRecording", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("transcribes with MockSttTransport and saves the transcript to recording and practice_run", async () => {
    const db = makeTestDb();
    seed(db);
    const runId = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q", questionKind: "random" }, ["e1"]);
    await insertRecording(db, {
      id: "rec1",
      thesisId: "t1",
      practiceRunId: runId,
      mimeType: "audio/webm",
      languageMode: "english",
      audioPath: "recordings/rec1.webm",
    });
    const setTranscriptSpy = vi.spyOn(recordingRepository, "setRecordingTranscript");

    const result = await transcribeRecording(db, new MockSttTransport("hello viva"), {
      recordingId: "rec1",
      audio: Buffer.from([1]),
    });

    expect(result).toEqual({ status: "ok", transcript: "hello viva" });
    expect(setTranscriptSpy).toHaveBeenCalledWith(db, "rec1", "hello viva");
    expect((db.prepare("SELECT transcript FROM practice_run WHERE id=?").get(runId) as { transcript: string }).transcript)
      .toBe("hello viva");
    db.close();
  });

  it("skips disabled transports and leaves stt_status unchanged", async () => {
    const db = makeTestDb();
    seed(db);
    await insertRecording(db, {
      id: "rec2",
      thesisId: "t1",
      mimeType: "audio/webm",
      languageMode: "english",
      audioPath: "recordings/rec2.webm",
    });
    const disabled: SttTransport = {
      enabled: false,
      transcribe: async () => {
        throw new Error("disabled");
      },
    };

    const result = await transcribeRecording(db, disabled, {
      recordingId: "rec2",
      audio: Buffer.from([1]),
    });

    expect(result).toEqual({ status: "skipped" });
    expect((db.prepare("SELECT stt_status FROM recording WHERE id=?").get("rec2") as { stt_status: string }).stt_status)
      .toBe("none");
    db.close();
  });

  it("marks the recording error when the transport throws", async () => {
    const db = makeTestDb();
    seed(db);
    await insertRecording(db, {
      id: "rec3",
      thesisId: "t1",
      mimeType: "audio/webm",
      languageMode: "english",
      audioPath: "recordings/rec3.webm",
    });
    const throwing: SttTransport = {
      enabled: true,
      transcribe: async () => {
        throw new Error("api down");
      },
    };

    const result = await transcribeRecording(db, throwing, {
      recordingId: "rec3",
      audio: Buffer.from([1]),
    });

    expect(result).toEqual({ status: "error" });
    expect(db.prepare("SELECT stt_status, stt_error FROM recording WHERE id=?").get("rec3")).toMatchObject({
      stt_status: "error",
      stt_error: "api down",
    });
    db.close();
  });
});
