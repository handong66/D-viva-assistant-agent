import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/db";
import { getPrepItemForEdit } from "../../db/repository";
import { editAndRevalidatePrepItem, editableFields } from "./edit";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,text,char_count,hash) VALUES ('c1','t1',0,'The cohort had 42 participants. We cite Bohr 1913 on spectra.',60,'h');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash) VALUES ('e1','t1','c1',0,60,'The cohort had 42 participants. We cite Bohr 1913 on spectra.','h');
    INSERT INTO generation_run (id,thesis_id,kind,status) VALUES ('g1','t1','prep_pack','done');
    INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,claim_text,evidence_quote,value_numeric,unit,status,validation_status,support_kind,validator_version,source)
      VALUES ('num','t1','g1','key_number','Sample size','42 participants',NULL,42,NULL,'verified','passed','numeric','1','generated');
    INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,claim_text,evidence_quote,value_numeric,unit,status,validation_status,support_kind,validator_version,source)
      VALUES ('cit','t1','g1','citation_card','Bohr','We cite Bohr 1913 on spectra.','We cite Bohr 1913 on spectra.',NULL,NULL,'verified','passed','exact_quote','1','generated');
    INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,claim_text,evidence_quote,value_numeric,unit,status,validation_status,support_kind,validator_version,source)
      VALUES ('qa','t1','g1','qa','Q','generated answer prose',NULL,NULL,NULL,'needs_review','needs_review','existence','1','generated');
    INSERT INTO prep_item_evidence (prep_item_id,evidence_unit_id) VALUES ('num','e1'),('cit','e1'),('qa','e1');
  `);
}

describe("editableFields", () => {
  it("only certified fields are editable per type", () => {
    expect(editableFields("key_number")).toEqual({ claim: false, quote: false, num: true });
    expect(editableFields("citation_card")).toEqual({ claim: false, quote: true, num: false });
    expect(editableFields("qa")).toEqual({ claim: true, quote: true, num: false });
  });
});

describe("editAndRevalidatePrepItem", () => {
  it("key_number: wrong number → unsafe, and a forged claim_text/quote is IGNORED (red line #1)", () => {
    const db = makeTestDb(); seed(db);
    const v = editAndRevalidatePrepItem(db, "num", { claimText: "Cancer is cured", evidenceQuote: "fabricated", valueNumeric: 99, unit: null });
    expect(v.validationStatus).toBe("failed");
    const a = getPrepItemForEdit(db, "num")!;
    expect(a.status).toBe("unsafe");
    expect(a.valueNumeric).toBe(99);                  // number is editable
    expect(a.claimText).toBe("42 participants");      // claim preserved — human text not applied
    expect(a.evidenceQuote).toBeNull();               // quote preserved
    db.close();
  });

  it("key_number: corrected number that IS in evidence → verified", () => {
    const db = makeTestDb(); seed(db);
    db.prepare("UPDATE prep_item SET value_numeric=99, status='unsafe', validation_status='failed' WHERE id='num'").run();
    const v = editAndRevalidatePrepItem(db, "num", { claimText: null, evidenceQuote: null, valueNumeric: 42, unit: null });
    expect(v.validationStatus).toBe("passed");
    expect(getPrepItemForEdit(db, "num")!.status).toBe("verified");
    db.close();
  });

  it("citation_card: a forged claim_text is IGNORED; the QUOTE governs (red line #1)", () => {
    const db = makeTestDb(); seed(db);
    // off-evidence quote → unsafe, and the human claim must NOT stick
    const bad = editAndRevalidatePrepItem(db, "cit", { claimText: "The author admits fraud", evidenceQuote: "not in the thesis", valueNumeric: 7, unit: "x" });
    expect(bad.validationStatus).toBe("failed");
    let a = getPrepItemForEdit(db, "cit")!;
    expect(a.status).toBe("unsafe");
    expect(a.claimText).toBe("We cite Bohr 1913 on spectra."); // claim preserved
    expect(a.valueNumeric).toBeNull();                          // number preserved (not a key_number)
    // a matching quote edit → verified again, claim still preserved
    const ok = editAndRevalidatePrepItem(db, "cit", { claimText: "junk", evidenceQuote: "We cite Bohr 1913 on spectra.", valueNumeric: null, unit: null });
    expect(ok.validationStatus).toBe("passed");
    a = getPrepItemForEdit(db, "cit")!;
    expect(a.status).toBe("verified");
    expect(a.claimText).toBe("We cite Bohr 1913 on spectra.");  // still the generated claim, not "junk"
    db.close();
  });

  it("prose (qa): claim_text IS editable but an ungrounded paraphrase stays needs_review", () => {
    const db = makeTestDb(); seed(db);
    const v = editAndRevalidatePrepItem(db, "qa", { claimText: "I claim victory", evidenceQuote: null, valueNumeric: 5, unit: "y" });
    expect(v.validationStatus).toBe("needs_review");            // never verified by typing prose
    const a = getPrepItemForEdit(db, "qa")!;
    expect(a.status).toBe("needs_review");
    expect(a.claimText).toBe("I claim victory");                // claim IS editable for prose
    expect(a.valueNumeric).toBeNull();                          // forged number ignored (not a key_number)
    db.close();
  });

  it("throws for an unknown id (no write)", () => {
    const db = makeTestDb(); seed(db);
    expect(() => editAndRevalidatePrepItem(db, "nope", { claimText: "x", evidenceQuote: null, valueNumeric: null, unit: null })).toThrow();
    db.close();
  });
});
