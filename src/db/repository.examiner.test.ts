import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { getThesisEvidenceWithSection, insertPracticeRunWithEvidence, getPracticeRunBoundEvidence } from "./repository";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c1','t1',0,'Methods','m',1,'h1');
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c2','t1',1,'Results','r',1,'h2');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e1','t1','c1','Methods',0,1,'method detail','h1');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e2','t1','c2','Results',0,1,'result 81.3%','h2');
  `);
}

describe("examiner repository", () => {
  it("getThesisEvidenceWithSection returns id+text+section in thesis order", () => {
    const db = makeTestDb(); seed(db);
    expect(getThesisEvidenceWithSection(db, "t1")).toEqual([
      { id: "e1", text: "method detail", section: "Methods" },
      { id: "e2", text: "result 81.3%", section: "Results" },
    ]);
    db.close();
  });

  it("insertPracticeRunWithEvidence atomically creates a 'practice' run AND binds its evidence", () => {
    const db = makeTestDb(); seed(db);
    const id = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Why 81.3%?", questionKind: "by_section" }, ["e2"]);
    const row = db.prepare("SELECT thesis_id, question, question_kind, status, answer_text FROM practice_run WHERE id=?").get(id) as {
      thesis_id: string; question: string; question_kind: string; status: string; answer_text: string | null;
    };
    expect(row).toMatchObject({ thesis_id: "t1", question: "Why 81.3%?", question_kind: "by_section", status: "practice", answer_text: null });
    expect(getPracticeRunBoundEvidence(db, id)).toEqual([{ id: "e2", text: "result 81.3%" }]);
    db.close();
  });

  it("insertPracticeRunWithEvidence rejects empty evidence and leaves no orphan run", () => {
    const db = makeTestDb(); seed(db);
    expect(() => insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q?", questionKind: "random" }, [])).toThrow(/evidence/i);
    expect((db.prepare("SELECT count(*) c FROM practice_run").get() as { c: number }).c).toBe(0);
    db.close();
  });

  it("insertPracticeRunWithEvidence rejects an invalid question_kind with a domain error (before any insert)", () => {
    const db = makeTestDb(); seed(db);
    expect(() => insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q?", questionKind: "bogus" }, ["e1"])).toThrow(/question_kind/i);
    expect((db.prepare("SELECT count(*) c FROM practice_run").get() as { c: number }).c).toBe(0);
    db.close();
  });

  it("insertPracticeRunWithEvidence rejects cross-thesis evidence (bind enforces same-thesis) with no orphan run", () => {
    const db = makeTestDb(); seed(db);
    db.exec(`
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t2','Other','md',0);
      INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c9','t2',0,'S','x',1,'h9');
      INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('eX','t2','c9','S',0,1,'x','h9');
    `);
    expect(() => insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q?", questionKind: "random" }, ["eX"])).toThrow();
    expect((db.prepare("SELECT count(*) c FROM practice_run").get() as { c: number }).c).toBe(0); // tx rolled back
    db.close();
  });
});
