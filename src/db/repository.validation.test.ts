import { describe, expect, it } from "vitest";
import type { Database as DB } from "better-sqlite3";
import { makeTestDb } from "../test/db";
import { VALIDATOR_VERSION, type Verdict } from "../lib/evidence/validator";
import { applyValidation, bindPrepEvidence, getBoundEvidence } from "./repository";

function seed(db: DB): void {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','A','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,text,char_count,hash) VALUES ('c1','t1',0,'x',1,'h1');
    INSERT INTO thesis_chunk (id,thesis_id,ord,text,char_count,hash) VALUES ('c2','t1',1,'y',1,'h2');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash)
      VALUES ('e2','t1','c2',0,18,'sample size was 40','he2');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash)
      VALUES ('e1','t1','c1',0,18,'accuracy was 81.3%','he1');
    INSERT INTO prep_item (id,thesis_id,type,title,value_numeric,unit,status,validation_status,validator_version,source)
      VALUES ('p1','t1','key_number','Acc',81.3,'%','needs_review','needs_review','0','generated');
    INSERT INTO prep_item (id,thesis_id,type,title,status,validation_status,validator_version,source)
      VALUES ('p2','t1','digest','Other','needs_review','needs_review','0','generated');
  `);
}

const passedVerdict: Verdict = {
  validationStatus: "passed",
  supportKind: "numeric",
  reason: "matched",
};

const failedVerdict: Verdict = {
  validationStatus: "failed",
  supportKind: "numeric",
  reason: "not matched",
};

describe("validation repository", () => {
  it("getBoundEvidence returns the correct EvidenceText[] for a given prepItemId", () => {
    const db = makeTestDb();
    seed(db);
    bindPrepEvidence(db, "p1", ["e2", "e1"]);
    bindPrepEvidence(db, "p2", ["e2"]);

    expect(getBoundEvidence(db, "p1")).toEqual([
      { id: "e1", text: "accuracy was 81.3%" },
      { id: "e2", text: "sample size was 40" },
    ]);

    db.close();
  });

  it("applyValidation with a passed verdict sets status='verified', validation_status='passed', sets verified_at, sets validator_version=VALIDATOR_VERSION", () => {
    const db = makeTestDb();
    seed(db);
    bindPrepEvidence(db, "p1", ["e1"]);

    applyValidation(db, "p1", passedVerdict);

    const row = db
      .prepare(
        "SELECT status, validation_status, support_kind, validator_version, verified_at FROM prep_item WHERE id='p1'",
      )
      .get() as {
      status: string;
      validation_status: string;
      support_kind: string | null;
      validator_version: string;
      verified_at: string | null;
    };
    expect(row.status).toBe("verified");
    expect(row.validation_status).toBe("passed");
    expect(row.support_kind).toBe("numeric");
    expect(row.validator_version).toBe(VALIDATOR_VERSION);
    expect(row.verified_at).not.toBeNull();

    db.close();
  });

  it("applyValidation with a passed verdict and no bound evidence leaves status='needs_review'", () => {
    const db = makeTestDb();
    seed(db);

    applyValidation(db, "p1", passedVerdict);

    const row = db
      .prepare(
        "SELECT status, validation_status, support_kind, validator_version, verified_at FROM prep_item WHERE id='p1'",
      )
      .get() as {
      status: string;
      validation_status: string;
      support_kind: string | null;
      validator_version: string;
      verified_at: string | null;
    };
    expect(row.status).toBe("needs_review");
    expect(row.validation_status).toBe("needs_review");
    expect(row.support_kind).toBe("numeric");
    expect(row.validator_version).toBe(VALIDATOR_VERSION);
    expect(row.verified_at).toBeNull();

    db.close();
  });

  it("applyValidation with a failed verdict sets status='unsafe', clears verified_at to NULL", () => {
    const db = makeTestDb();
    seed(db);
    db.prepare("UPDATE prep_item SET verified_at = datetime('now') WHERE id='p1'").run();

    applyValidation(db, "p1", failedVerdict);

    const row = db
      .prepare("SELECT status, validation_status, support_kind, verified_at FROM prep_item WHERE id='p1'")
      .get() as {
      status: string;
      validation_status: string;
      support_kind: string | null;
      verified_at: string | null;
    };
    expect(row.status).toBe("unsafe");
    expect(row.validation_status).toBe("failed");
    expect(row.support_kind).toBe("numeric");
    expect(row.verified_at).toBeNull();

    db.close();
  });

  it("after a passing validation, a subsequent failed verdict clears verified_at", () => {
    const db = makeTestDb();
    seed(db);
    bindPrepEvidence(db, "p1", ["e1"]);

    applyValidation(db, "p1", passedVerdict);
    expect(
      (db.prepare("SELECT verified_at FROM prep_item WHERE id='p1'").get() as { verified_at: string | null })
        .verified_at,
    ).not.toBeNull();

    applyValidation(db, "p1", failedVerdict);

    const row = db.prepare("SELECT status, verified_at FROM prep_item WHERE id='p1'").get() as {
      status: string;
      verified_at: string | null;
    };
    expect(row.status).toBe("unsafe");
    expect(row.verified_at).toBeNull();

    db.close();
  });
});
