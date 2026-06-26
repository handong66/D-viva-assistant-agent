import { describe, it, expect } from "vitest";
import type { Database as DB } from "better-sqlite3";
import { makeTestDb } from "../../test/db";
import { MockLlmClient } from "./mock";
import { runPrepPackGeneration } from "./prep-pack-run";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,text,char_count,hash) VALUES ('c1','t1',0,'accuracy was 81.3%',18,'h');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash) VALUES ('e1','t1','c1',0,18,'accuracy was 81.3%','h');
  `);
}

function withPostBindEvidenceReadFailure(db: DB): DB {
  return {
    prepare(sql: string) {
      if (sql.includes("FROM prep_item_evidence") && sql.includes("JOIN evidence_unit")) {
        throw new Error("post-bind evidence read failed");
      }
      return db.prepare(sql);
    },
    transaction: db.transaction.bind(db),
    exec: db.exec.bind(db),
  } as unknown as DB;
}

describe("runPrepPackGeneration", () => {
  it("persists, binds, and validates generated items; provable key_number -> verified, paraphrase -> needs_review", async () => {
    const db = makeTestDb(); seed(db);
    const mock = new MockLlmClient().setObject("prep_pack", {
      items: [
        { type: "key_number", title: "Acc", claim_text: "accuracy 81.3%", value_numeric: 81.3, unit: "%", evidence_unit_ids: ["e1"] },
        { type: "qa", title: "Q", claim_text: "the study is about voice emotion", evidence_quote: null, value_numeric: null, unit: null, evidence_unit_ids: ["e1"] },
      ],
    });
    const res = await runPrepPackGeneration(db, mock, "t1");
    expect(res.runStatus).toBe("done");
    expect(res.itemCount).toBe(2);
    const byType = (t: string) => db.prepare("SELECT status, validation_status FROM prep_item WHERE thesis_id='t1' AND type=?").get(t) as { status: string; validation_status: string };
    expect(byType("key_number")).toMatchObject({ status: "verified", validation_status: "passed" }); // 81.3% is in evidence
    expect(byType("qa")).toMatchObject({ status: "needs_review" }); // paraphrase, not provable
    // each item is bound to its cited evidence
    expect((db.prepare("SELECT count(*) c FROM prep_item_evidence").get() as { c: number }).c).toBe(2);
    db.close();
  });

  it("continues the run when one item cites bad/cross-thesis evidence — only that item is unsafe", async () => {
    const db = makeTestDb(); seed(db);
    db.exec(`
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t2','Other','md',0);
      INSERT INTO thesis_chunk (id,thesis_id,ord,text,char_count,hash) VALUES ('c2','t2',0,'x',1,'h');
      INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash) VALUES ('eX','t2','c2',0,1,'x','h');
    `);
    const mock = new MockLlmClient().setObject("prep_pack", {
      items: [
        { type: "qa", title: "Good", claim_text: "voice emotion", evidence_quote: null, value_numeric: null, unit: null, evidence_unit_ids: ["e1"] },
        { type: "qa", title: "Bad", claim_text: "cross", evidence_quote: null, value_numeric: null, unit: null, evidence_unit_ids: ["eX"] }, // belongs to t2
      ],
    });
    const res = await runPrepPackGeneration(db, mock, "t1");
    expect(res.runStatus).toBe("done");
    expect((db.prepare("SELECT status FROM prep_item WHERE title='Good'").get() as { status: string }).status).toBe("needs_review");
    expect((db.prepare("SELECT status FROM prep_item WHERE title='Bad'").get() as { status: string }).status).toBe("unsafe");
    expect((db.prepare("SELECT count(*) c FROM prep_item_evidence WHERE evidence_unit_id='eX'").get() as { c: number }).c).toBe(0); // no partial binding
    db.close();
  });

  it("records the run as error and rethrows-safe when the LLM is disabled", async () => {
    const db = makeTestDb(); seed(db);
    const disabled = { enabled: false, generateObject: () => Promise.reject(new Error("disabled")), generateText: () => Promise.reject(new Error("disabled")) };
    await expect(runPrepPackGeneration(db, disabled as never, "t1")).rejects.toThrow();
    expect((db.prepare("SELECT status FROM generation_run WHERE thesis_id='t1'").get() as { status: string }).status).toBe("error");
    db.close();
  });

  it("records the run as error and rethrows when a post-bind DB read fails", async () => {
    const db = makeTestDb(); seed(db);
    const mock = new MockLlmClient().setObject("prep_pack", {
      items: [
        { type: "key_number", title: "Acc", claim_text: "accuracy 81.3%", value_numeric: 81.3, unit: "%", evidence_unit_ids: ["e1"] },
      ],
    });

    await expect(runPrepPackGeneration(withPostBindEvidenceReadFailure(db), mock, "t1")).rejects.toThrow(
      "post-bind evidence read failed",
    );

    expect((db.prepare("SELECT count(*) c FROM prep_item_evidence WHERE evidence_unit_id='e1'").get() as { c: number }).c).toBe(1);
    const run = db.prepare("SELECT status, error FROM generation_run WHERE thesis_id='t1'").get() as {
      status: string;
      error: string | null;
    };
    expect(run.status).toBe("error");
    expect(run.error).toContain("post-bind evidence read failed");
    db.close();
  });
});
