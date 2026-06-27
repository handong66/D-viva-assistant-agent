import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/db";
import { MockLlmClient } from "./mock";
import type { LlmClient, GenerateObjectArgs } from "./types";
import { insertPracticeRunWithEvidence } from "../../db/repository";
import { runJudge } from "./judge-run";

function seedRun(db: ReturnType<typeof makeTestDb>, answer?: { text?: string; transcript?: string }) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c1','t1',0,'S','x',1,'h1');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e1','t1','c1','S',0,1,'accuracy was 81.3%','h1');
  `);
  const id = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Why 81.3%?", questionKind: "random" }, ["e1"]);
  if (answer?.text) db.prepare("UPDATE practice_run SET answer_text=? WHERE id=?").run(answer.text, id);
  if (answer?.transcript) db.prepare("UPDATE practice_run SET transcript=? WHERE id=?").run(answer.transcript, id);
  return id;
}

const result = {
  scores: { evidence: 2, clarity: 4, completeness: 4, boundary: 5, delivery: 4 },
  reasons: { evidence: "no citation", clarity: "clear", completeness: "covers it", boundary: "scoped", delivery: "fluent" },
  diagnosis: "weak grounding", rewrite: "better answer", follow_ups: ["f1"],
};

/** A typed LlmClient stub that records the prompt it was handed (to assert red-line #1).
 *  Typed as LlmClient (not `as never`) so any LlmClient interface drift surfaces here. */
function capturingClient(scripted: unknown) {
  const calls: { prompt: string }[] = [];
  const client: LlmClient = {
    enabled: true,
    generateObject: async <T>(args: GenerateObjectArgs<T>): Promise<T> => {
      calls.push({ prompt: args.prompt });
      return scripted as T;
    },
    generateText: async () => "",
  };
  return { client, calls };
}

describe("runJudge", () => {
  it("feeds the judge ONLY the run's bound evidence (red line #1) + the answer - not the whole thesis", async () => {
    const db = makeTestDb();
    db.exec(`
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
      INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c1','t1',0,'S','x',1,'h1');
      INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e1','t1','c1','S',0,1,'BOUND evidence sentence','h1');
      INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e2','t1','c1','S',1,2,'UNBOUND other sentence','h2');
    `);
    const id = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Why?", questionKind: "random" }, ["e1"]);
    db.prepare("UPDATE practice_run SET answer_text=? WHERE id=?").run("MY ANSWER TEXT", id);

    const cap = capturingClient(result);
    await runJudge(db, cap.client, id);
    const prompt = cap.calls[0]?.prompt ?? "";
    expect(prompt).toContain("BOUND evidence sentence");
    expect(prompt).not.toContain("UNBOUND other sentence");
    expect(prompt).toContain("MY ANSWER TEXT");
    db.close();
  });

  it("judges the answer against the run's bound evidence, persists scores, and queues low dimensions", async () => {
    const db = makeTestDb(); const id = seedRun(db, { text: "because tuned" });
    const mock = new MockLlmClient().setObject("judge", result);
    const out = await runJudge(db, mock, id);

    expect(out.reviewDimensions).toEqual(["evidence"]);
    expect(out.scores.boundary).toBe(5);
    expect(mock.calls[0]).toEqual({ kind: "object", role: "hard", purpose: "judge" });
    const run = db.prepare("SELECT scores, diagnosis FROM practice_run WHERE id=?").get(id) as { scores: string; diagnosis: string };
    expect(JSON.parse(run.scores).evidence).toBe(2);
    expect((db.prepare("SELECT count(*) c FROM review_item WHERE practice_run_id=?").get(id) as { c: number }).c).toBe(1);
    expect((db.prepare("SELECT reason FROM review_item WHERE practice_run_id=? AND dimension='evidence'").get(id) as { reason: string }).reason).toBe("no citation");
    db.close();
  });

  it("uses the transcript when answer_text is empty", async () => {
    const db = makeTestDb(); const id = seedRun(db, { transcript: "spoken answer" });
    const out = await runJudge(db, new MockLlmClient().setObject("judge", result), id);
    expect(out.scores.evidence).toBe(2);
    db.close();
  });

  it("throws when the run has neither answer nor transcript (nothing persisted)", async () => {
    const db = makeTestDb(); const id = seedRun(db);
    await expect(runJudge(db, new MockLlmClient().setObject("judge", result), id)).rejects.toThrow(/no answer/i);
    expect((db.prepare("SELECT scores FROM practice_run WHERE id=?").get(id) as { scores: string | null }).scores).toBeNull();
    db.close();
  });

  it("throws when the practice_run does not exist", async () => {
    const db = makeTestDb(); seedRun(db, { text: "a" });
    await expect(runJudge(db, new MockLlmClient().setObject("judge", result), "nope")).rejects.toThrow(/not found/i);
    db.close();
  });

  it("a disabled client rejects and persists no scores", async () => {
    const db = makeTestDb(); const id = seedRun(db, { text: "a" });
    const disabled = { enabled: false, generateObject: () => Promise.reject(new Error("disabled")), generateText: () => Promise.reject(new Error("disabled")) };
    await expect(runJudge(db, disabled as never, id)).rejects.toThrow();
    expect((db.prepare("SELECT scores FROM practice_run WHERE id=?").get(id) as { scores: string | null }).scores).toBeNull();
    db.close();
  });
});
