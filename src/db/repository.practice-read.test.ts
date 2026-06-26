import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { getLatestPracticeRun, getReviewItems, saveAnswer, insertPracticeRunWithEvidence } from "./repository";

function seedThesis(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c1','t1',0,'S','x',1,'h1');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e1','t1','c1','S',0,1,'evidence','h1');
  `);
}

describe("practice reads", () => {
  it("getLatestPracticeRun returns the most recent run with parsed scores/follow_ups", () => {
    const db = makeTestDb(); seedThesis(db);
    insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q old", questionKind: "random" }, ["e1"]);
    const newId = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q new", questionKind: "hostile" }, ["e1"]);
    db.prepare("UPDATE practice_run SET scores=?, follow_ups=?, diagnosis=? WHERE id=?")
      .run(JSON.stringify({ evidence: 2, clarity: 4, completeness: 3, boundary: 5, delivery: 4 }), JSON.stringify(["dig deeper?"]), "weak grounding", newId);

    const run = getLatestPracticeRun(db, "t1")!;
    expect(run.question).toBe("Q new");
    expect(run.scores).toEqual({ evidence: 2, clarity: 4, completeness: 3, boundary: 5, delivery: 4 });
    expect(run.followUps).toEqual(["dig deeper?"]);
    expect(getLatestPracticeRun(makeTestDb(), "t1")).toBeUndefined();
    db.close();
  });

  it("saveAnswer sets answer_text on the run", () => {
    const db = makeTestDb(); seedThesis(db);
    const id = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q", questionKind: "random" }, ["e1"]);
    saveAnswer(db, id, "  my typed answer  ");
    expect((db.prepare("SELECT answer_text FROM practice_run WHERE id=?").get(id) as { answer_text: string }).answer_text).toBe("my typed answer");
    db.close();
  });

  it("getReviewItems returns open items joined to their question, worst score first", () => {
    const db = makeTestDb(); seedThesis(db);
    const id = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Why 81.3%?", questionKind: "random" }, ["e1"]);
    db.exec(`
      INSERT INTO review_item (id,thesis_id,practice_run_id,dimension,score,reason,status) VALUES ('ri1','t1','${id}','clarity',2,'unclear','open');
      INSERT INTO review_item (id,thesis_id,practice_run_id,dimension,score,reason,status) VALUES ('ri2','t1','${id}','evidence',1,'unsupported','open');
      INSERT INTO review_item (id,thesis_id,practice_run_id,dimension,score,reason,status) VALUES ('ri3','t1','${id}','boundary',2,'fixed already','fixed');
      INSERT INTO review_item (id,thesis_id,practice_run_id,dimension,score,reason,status) VALUES ('ri4','t1','${id}','completeness',3,'ok-ish','open');
    `);
    const items = getReviewItems(db, "t1");
    expect(items.map((i) => i.dimension)).toEqual(["evidence", "clarity"]); // open AND score<=2; 'ri3' fixed + 'ri4' score 3 are excluded
    expect(items[0]).toMatchObject({ dimension: "evidence", score: 1, reason: "unsupported", question: "Why 81.3%?" });
    db.close();
  });
});
