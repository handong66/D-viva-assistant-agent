import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { getPracticeRunForJudge, applyJudgeResult, getRunReviewItems, insertPracticeRunWithEvidence } from "./repository";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c1','t1',0,'S','x',1,'h1');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e1','t1','c1','S',0,1,'evidence text','h1');
  `);
  return insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Why 81.3%?", questionKind: "random" }, ["e1"]);
}

const scores = { evidence: 2, clarity: 4, completeness: 1, boundary: 5, delivery: 3 };
const reasons = {
  evidence: "cited no source",
  clarity: "ok",
  completeness: "skipped the method",
  boundary: "ok",
  delivery: "ok",
};

describe("judge repository", () => {
  it("getPracticeRunForJudge returns the run's judge inputs, undefined when missing", () => {
    const db = makeTestDb(); const id = seed(db);
    expect(getPracticeRunForJudge(db, id)).toMatchObject({ thesisId: "t1", question: "Why 81.3%?" });
    expect(getPracticeRunForJudge(db, "nope")).toBeUndefined();
    db.close();
  });

  it("applyJudgeResult persists scores/diagnosis/rewrite/follow_ups and returns the review dimensions (<=2)", () => {
    const db = makeTestDb(); const id = seed(db);
    const reviewed = applyJudgeResult(db, { practiceRunId: id, thesisId: "t1", scores, reasons, diagnosis: "weak evidence", rewrite: "better", followUps: ["f1"] });
    expect(reviewed.sort()).toEqual(["completeness", "evidence"]);

    const run = db.prepare("SELECT scores, diagnosis, rewrite, follow_ups FROM practice_run WHERE id=?").get(id) as { scores: string; diagnosis: string; rewrite: string; follow_ups: string };
    expect(JSON.parse(run.scores)).toEqual(scores);
    expect(run.diagnosis).toBe("weak evidence");
    expect(run.rewrite).toBe("better");
    expect(JSON.parse(run.follow_ups)).toEqual(["f1"]);

    const items = db.prepare("SELECT dimension, score, reason, status FROM review_item WHERE practice_run_id=? ORDER BY dimension").all(id) as { dimension: string; score: number; reason: string; status: string }[];
    expect(items).toEqual([
      { dimension: "completeness", score: 1, reason: "skipped the method", status: "open" },
      { dimension: "evidence", score: 2, reason: "cited no source", status: "open" },
    ]);
    db.close();
  });

  it("getRunReviewItems returns this run's weak dimensions with per-dim reasons (worst first)", () => {
    const db = makeTestDb(); const id = seed(db);
    applyJudgeResult(db, { practiceRunId: id, thesisId: "t1", scores, reasons, diagnosis: "weak evidence", rewrite: "better", followUps: ["f1"] });
    const weak = getRunReviewItems(db, id);
    expect(weak).toEqual([
      { dimension: "completeness", score: 1, reason: "skipped the method" },
      { dimension: "evidence", score: 2, reason: "cited no source" },
    ]);
    db.close();
  });

  it("re-judging is idempotent: review_item rows are replaced, not duplicated (no unique violation)", () => {
    const db = makeTestDb(); const id = seed(db);
    applyJudgeResult(db, { practiceRunId: id, thesisId: "t1", scores, reasons, diagnosis: "d1", rewrite: "r1", followUps: [] });
    const reviewed = applyJudgeResult(db, { practiceRunId: id, thesisId: "t1", scores: { evidence: 5, clarity: 5, completeness: 5, boundary: 5, delivery: 1 }, reasons: { ...reasons, delivery: "hard to follow" }, diagnosis: "d2", rewrite: "r2", followUps: [] });
    expect(reviewed).toEqual(["delivery"]);
    const items = db.prepare("SELECT dimension FROM review_item WHERE practice_run_id=?").all(id) as { dimension: string }[];
    expect(items.map((i) => i.dimension)).toEqual(["delivery"]);
    db.close();
  });

  it("all-high scores create no review_item rows", () => {
    const db = makeTestDb(); const id = seed(db);
    const reviewed = applyJudgeResult(db, { practiceRunId: id, thesisId: "t1", scores: { evidence: 5, clarity: 4, completeness: 3, boundary: 5, delivery: 4 }, reasons, diagnosis: "good", rewrite: "r", followUps: [] });
    expect(reviewed).toEqual([]);
    expect((db.prepare("SELECT count(*) c FROM review_item WHERE practice_run_id=?").get(id) as { c: number }).c).toBe(0);
    db.close();
  });

  it("rejects an out-of-range score before any write (review_item.score has no 1-5 DB CHECK)", () => {
    const db = makeTestDb(); const id = seed(db);
    expect(() =>
      applyJudgeResult(db, { practiceRunId: id, thesisId: "t1", scores: { ...scores, clarity: 7 }, reasons, diagnosis: "d", rewrite: "r", followUps: [] }),
    ).toThrow(/1-5/);
    expect((db.prepare("SELECT scores FROM practice_run WHERE id=?").get(id) as { scores: string | null }).scores).toBeNull();
    db.close();
  });
});
