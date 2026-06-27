import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { getThesisStats } from "./repository";

describe("getThesisStats", () => {
  it("counts evidence, prep items by status, practice runs, and open reviews", () => {
    const db = makeTestDb();
    db.exec(`
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
      INSERT INTO thesis_chunk (id,thesis_id,ord,text,char_count,hash) VALUES ('c1','t1',0,'x',1,'h');
      INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash) VALUES ('e1','t1','c1',0,1,'x','h');
      INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash) VALUES ('e2','t1','c1',0,1,'y','h');
      INSERT INTO prep_item (id,thesis_id,type,title,status,validation_status,validator_version,source) VALUES ('p1','t1','qa','A','verified','passed','1','generated');
      INSERT INTO prep_item (id,thesis_id,type,title,status,validation_status,validator_version,source) VALUES ('p2','t1','qa','B','needs_review','needs_review','1','generated');
      INSERT INTO prep_item (id,thesis_id,type,title,status,validation_status,validator_version,source) VALUES ('p3','t1','qa','C','unsafe','failed','1','generated');
      INSERT INTO prep_item (id,thesis_id,type,title,status,validation_status,validator_version,source) VALUES ('p4','t1','qa','D','draft','needs_review','0','manual');
      INSERT INTO practice_run (id,thesis_id,question,question_kind,status) VALUES ('pr1','t1','Q','random','practice');
      INSERT INTO review_item (id,thesis_id,practice_run_id,dimension,score,status) VALUES ('ri1','t1','pr1','evidence',2,'open');
      INSERT INTO review_item (id,thesis_id,practice_run_id,dimension,score,status) VALUES ('ri2','t1','pr1','clarity',1,'fixed');
    `);
    expect(getThesisStats(db, "t1")).toEqual({
      evidenceUnits: 2, prepTotal: 4, prepVerified: 1, prepNeedsReview: 1, prepUnsafe: 1, prepDraft: 1, practiceRuns: 1, openReviews: 1,
    });
    db.close();
  });
  it("returns zeroes for a thesis with nothing", () => {
    const db = makeTestDb();
    db.exec(`INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);`);
    expect(getThesisStats(db, "t1")).toEqual({ evidenceUnits: 0, prepTotal: 0, prepVerified: 0, prepNeedsReview: 0, prepUnsafe: 0, prepDraft: 0, practiceRuns: 0, openReviews: 0 });
    db.close();
  });
});
