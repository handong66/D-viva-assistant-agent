import { describe, expect, it } from "vitest";
import { makeTestDb } from "../test/db";
import { getPrepItems } from "./repository";

describe("getPrepItems", () => {
  it("returns items from latest done run, excludes older run and errored run", () => {
    const db = makeTestDb();
    db.exec(`
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
      INSERT INTO generation_run (id,thesis_id,kind,status,created_at)
        VALUES ('older_done','t1','prep_pack','done','2024-01-01T00:00:00Z');
      INSERT INTO generation_run (id,thesis_id,kind,status,created_at)
        VALUES ('latest_done','t1','prep_pack','done','2024-01-02T00:00:00Z');
      INSERT INTO generation_run (id,thesis_id,kind,status,created_at)
        VALUES ('errored','t1','prep_pack','error','2024-01-03T00:00:00Z');
      INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,claim_text,status,validation_status,validator_version,source,created_at)
        VALUES ('old_item','t1','older_done','qa','Old','old claim','verified','passed','1','generated','2024-01-01T00:00:01Z');
      INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,claim_text,status,validation_status,validator_version,source,created_at)
        VALUES ('latest_qa','t1','latest_done','qa','Question','latest claim','needs_review','needs_review','1','generated','2024-01-02T00:00:02Z');
      INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,claim_text,status,validation_status,validator_version,source,created_at)
        VALUES ('latest_key','t1','latest_done','key_number','Accuracy','81.3%','verified','passed','1','generated','2024-01-02T00:00:01Z');
      INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,claim_text,status,validation_status,validator_version,source,created_at)
        VALUES ('errored_item','t1','errored','qa','Errored','bad claim','needs_review','needs_review','1','generated','2024-01-03T00:00:01Z');
    `);

    const items = getPrepItems(db, "t1");

    expect(items.map((item) => item.id)).toEqual(["latest_key", "latest_qa"]);
    expect(items[0]).toMatchObject({
      id: "latest_key",
      title: "Accuracy",
      claimText: "81.3%",
      status: "verified",
      validationStatus: "passed",
    });
    db.close();
  });

  it("returns empty array when no done run exists", () => {
    const db = makeTestDb();
    db.exec(`
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
      INSERT INTO generation_run (id,thesis_id,kind,status,created_at)
        VALUES ('errored','t1','prep_pack','error','2024-01-03T00:00:00Z');
      INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,claim_text,status,validation_status,validator_version,source)
        VALUES ('errored_item','t1','errored','qa','Errored','bad claim','needs_review','needs_review','1','generated');
    `);

    expect(getPrepItems(db, "t1")).toEqual([]);
    db.close();
  });

  it("rowid tiebreaker: same created_at picks run with higher rowid", () => {
    const db = makeTestDb();
    db.exec(`
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
      INSERT INTO generation_run (id,thesis_id,kind,status,created_at)
        VALUES ('zzz_first','t1','prep_pack','done','2024-01-05T00:00:00Z');
      INSERT INTO generation_run (id,thesis_id,kind,status,created_at)
        VALUES ('aaa_second','t1','prep_pack','done','2024-01-05T00:00:00Z');
      INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,claim_text,status,validation_status,validator_version,source)
        VALUES ('first_item','t1','zzz_first','qa','First','first claim','needs_review','needs_review','1','generated');
      INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,claim_text,status,validation_status,validator_version,source)
        VALUES ('second_item','t1','aaa_second','qa','Second','second claim','needs_review','needs_review','1','generated');
    `);

    expect(getPrepItems(db, "t1").map((item) => item.id)).toEqual(["second_item"]);
    db.close();
  });
});
