import { describe, expect, it } from "vitest";
import { makeTestDb } from "../test/db";
import { insertPracticeRunWithEvidence, insertRecording, setRecordingTranscript } from "./repository";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c1','t1',0,'S','x',1,'h');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e1','t1','c1','S',0,1,'x','h');
  `);
}

describe("recording repository", () => {
  it("insertRecording creates a row and leaves stt_status at the DB default", async () => {
    const db = makeTestDb();
    seed(db);
    const runId = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q", questionKind: "random" }, ["e1"]);

    await insertRecording(db, {
      id: "rec1",
      thesisId: "t1",
      practiceRunId: runId,
      mimeType: "audio/webm",
      languageMode: "english",
      durationMs: 123,
      audioPath: "recordings/rec1.webm",
    });

    expect(
      db.prepare("SELECT thesis_id, practice_run_id, path, mime, duration_ms, language_mode, stt_status FROM recording WHERE id=?")
        .get("rec1"),
    ).toMatchObject({
      thesis_id: "t1",
      practice_run_id: runId,
      path: "recordings/rec1.webm",
      mime: "audio/webm",
      duration_ms: 123,
      language_mode: "english",
      stt_status: "none",
    });
    db.close();
  });

  it("setRecordingTranscript trims and copies the transcript to the linked practice_run", async () => {
    const db = makeTestDb();
    seed(db);
    const runId = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q", questionKind: "random" }, ["e1"]);
    await insertRecording(db, {
      id: "rec2",
      thesisId: "t1",
      practiceRunId: runId,
      mimeType: "audio/webm",
      languageMode: "english",
      audioPath: "recordings/rec2.webm",
    });

    await setRecordingTranscript(db, "rec2", "  spoken answer  ");

    expect(db.prepare("SELECT transcript, stt_status, stt_error FROM recording WHERE id=?").get("rec2")).toMatchObject({
      transcript: "spoken answer",
      stt_status: "ok",
      stt_error: null,
    });
    expect((db.prepare("SELECT transcript FROM practice_run WHERE id=?").get(runId) as { transcript: string }).transcript)
      .toBe("spoken answer");
    db.close();
  });
});
