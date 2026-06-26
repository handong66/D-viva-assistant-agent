import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/db";
import { MockLlmClient } from "./mock";
import { runExaminerQuestion } from "./examiner-run";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c1','t1',0,'Methods','m',1,'h1');
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c2','t1',1,'Results','r',1,'h2');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e1','t1','c1','Methods',0,1,'method detail','h1');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e2','t1','c2','Results',0,1,'result 81.3%','h2');
  `);
}

describe("runExaminerQuestion", () => {
  it("generates a question, persists a practice_run, and binds the cited evidence", async () => {
    const db = makeTestDb(); seed(db);
    const mock = new MockLlmClient().setObject("examiner:by_section", { question: "Why 81.3%?", evidence_unit_ids: ["e2"] });
    const res = await runExaminerQuestion(db, mock, "t1", "by_section", { section: "Results" });

    expect(res.question).toBe("Why 81.3%?");
    expect(res.evidenceUnitIds).toEqual(["e2"]);
    const run = db.prepare("SELECT question_kind, status FROM practice_run WHERE id=?").get(res.practiceRunId) as { question_kind: string; status: string };
    expect(run).toMatchObject({ question_kind: "by_section", status: "practice" });
    expect((db.prepare("SELECT evidence_unit_id FROM practice_run_evidence WHERE practice_run_id=?").get(res.practiceRunId) as { evidence_unit_id: string }).evidence_unit_id).toBe("e2");
    db.close();
  });

  it("drops cited ids that were not in the offered candidate set (anti-hallucination)", async () => {
    const db = makeTestDb(); seed(db);
    // by_section=Results offers only e2; the model also cites e1 (Methods, not offered) and 'eX' (nonexistent)
    const mock = new MockLlmClient().setObject("examiner:by_section", { question: "Q?", evidence_unit_ids: ["e2", "e1", "eX"] });
    const res = await runExaminerQuestion(db, mock, "t1", "by_section", { section: "Results" });
    expect(res.evidenceUnitIds).toEqual(["e2"]);
    expect((db.prepare("SELECT count(*) c FROM practice_run_evidence WHERE practice_run_id=?").get(res.practiceRunId) as { c: number }).c).toBe(1);
    db.close();
  });

  it("throws and persists nothing when the model cites no offered evidence", async () => {
    const db = makeTestDb(); seed(db);
    const mock = new MockLlmClient().setObject("examiner:by_section", { question: "Q?", evidence_unit_ids: ["eX"] });
    await expect(runExaminerQuestion(db, mock, "t1", "by_section", { section: "Results" })).rejects.toThrow(/no provided evidence/i);
    expect((db.prepare("SELECT count(*) c FROM practice_run").get() as { c: number }).c).toBe(0); // no orphan run
    db.close();
  });

  it("by_section without a section is rejected (no whole-thesis fallback)", async () => {
    const db = makeTestDb(); seed(db);
    const mock = new MockLlmClient().setObject("examiner:by_section", { question: "Q?", evidence_unit_ids: ["e1"] });
    await expect(runExaminerQuestion(db, mock, "t1", "by_section")).rejects.toThrow(/requires opts\.section/i);
    db.close();
  });

  it("followup uses the previous run's bound evidence and previous Q/A", async () => {
    const db = makeTestDb(); seed(db);
    const first = await runExaminerQuestion(
      db,
      new MockLlmClient().setObject("examiner:random", { question: "Q1?", evidence_unit_ids: ["e1"] }),
      "t1",
      "random",
    );
    db.prepare("UPDATE practice_run SET answer_text='my answer' WHERE id=?").run(first.practiceRunId);

    const mock = new MockLlmClient().setObject("examiner:followup", { question: "Follow up on e1?", evidence_unit_ids: ["e1"] });
    const res = await runExaminerQuestion(db, mock, "t1", "followup", { previousRunId: first.practiceRunId });
    expect(res.evidenceUnitIds).toEqual(["e1"]);
    db.close();
  });

  it("followup falls back to the transcript when answer_text is empty", async () => {
    const db = makeTestDb(); seed(db);
    const first = await runExaminerQuestion(
      db,
      new MockLlmClient().setObject("examiner:random", { question: "Q1?", evidence_unit_ids: ["e1"] }),
      "t1",
      "random",
    );
    db.prepare("UPDATE practice_run SET transcript='spoken answer' WHERE id=?").run(first.practiceRunId);
    const mock = new MockLlmClient().setObject("examiner:followup", { question: "F?", evidence_unit_ids: ["e1"] });
    const res = await runExaminerQuestion(db, mock, "t1", "followup", { previousRunId: first.practiceRunId });
    expect(res.evidenceUnitIds).toEqual(["e1"]);
    db.close();
  });

  it("followup throws when the previous run has neither answer nor transcript", async () => {
    const db = makeTestDb(); seed(db);
    const first = await runExaminerQuestion(
      db,
      new MockLlmClient().setObject("examiner:random", { question: "Q1?", evidence_unit_ids: ["e1"] }),
      "t1",
      "random",
    );
    const mock = new MockLlmClient().setObject("examiner:followup", { question: "F?", evidence_unit_ids: ["e1"] });
    await expect(runExaminerQuestion(db, mock, "t1", "followup", { previousRunId: first.practiceRunId })).rejects.toThrow(/no answer/i);
    db.close();
  });

  it("followup rejects a previous run that belongs to another thesis", async () => {
    const db = makeTestDb(); seed(db);
    db.exec(`INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t2','Other','md',0);`);
    const first = await runExaminerQuestion(
      db,
      new MockLlmClient().setObject("examiner:random", { question: "Q1?", evidence_unit_ids: ["e1"] }),
      "t1",
      "random",
    );
    db.prepare("UPDATE practice_run SET answer_text='a' WHERE id=?").run(first.practiceRunId);
    const mock = new MockLlmClient().setObject("examiner:followup", { question: "F?", evidence_unit_ids: ["e1"] });
    await expect(runExaminerQuestion(db, mock, "t2", "followup", { previousRunId: first.practiceRunId })).rejects.toThrow(/not found for this thesis/i);
    db.close();
  });

  it("a disabled client rejects and persists nothing", async () => {
    const db = makeTestDb(); seed(db);
    const disabled = { enabled: false, generateObject: () => Promise.reject(new Error("disabled")), generateText: () => Promise.reject(new Error("disabled")) };
    await expect(runExaminerQuestion(db, disabled as never, "t1", "random")).rejects.toThrow();
    expect((db.prepare("SELECT count(*) c FROM practice_run").get() as { c: number }).c).toBe(0);
    db.close();
  });
});
