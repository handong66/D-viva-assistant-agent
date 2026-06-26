import { describe, it, expect } from "vitest";
import { validatePrepItem, VALIDATOR_VERSION, type PrepItemInput, type EvidenceText } from "./validator";

const base: PrepItemInput = { type: "digest", claim_text: "x", evidence_quote: null, value_numeric: null, unit: null };
const ev = (text: string): EvidenceText => ({ id: "e1", text });

describe("validatePrepItem L1", () => {
  it("exposes a validator version", () => {
    expect(VALIDATOR_VERSION).toBe("1");
  });
  it("digest with >=1 evidence and no quote -> needs_review/existence", () => {
    const v = validatePrepItem(base, [ev("anything")]);
    expect(v).toEqual({ validationStatus: "needs_review", supportKind: "existence", reason: expect.any(String) });
  });
  it("key_number with no evidence -> failed", () => {
    const v = validatePrepItem({ ...base, type: "key_number", value_numeric: 5 }, []);
    expect(v.validationStatus).toBe("failed");
  });
});

describe("validatePrepItem L2 exact quote", () => {
  it("citation_card passes when its quote matches bound text (normalized)", () => {
    const item = { ...base, type: "citation_card" as const, claim_text: "Smith 2020 found X", evidence_quote: "Smith  2020 found X" };
    const v = validatePrepItem(item, [ev("As Smith 2020 found X in their study")]);
    expect(v).toEqual({ validationStatus: "passed", supportKind: "exact_quote", reason: expect.any(String) });
  });
  it("citation_card fails when its quote is not found", () => {
    const v = validatePrepItem({ ...base, type: "citation_card" as const, evidence_quote: "not present" }, [ev("something else")]);
    expect(v.validationStatus).toBe("failed");
  });
  it("citation_card without an evidence_quote fails", () => {
    expect(validatePrepItem({ ...base, type: "citation_card" as const }, [ev("anything")]).validationStatus).toBe("failed");
  });
  it("prose item whose quote matches but claim is a PARAPHRASE -> needs_review (not verified)", () => {
    const item = { ...base, type: "digest" as const, claim_text: "the study found a clear result", evidence_quote: "key finding" };
    expect(validatePrepItem(item, [ev("the key finding was clear")]).validationStatus).toBe("needs_review");
  });
  it("prose item whose claim_text IS verbatim the matched quote -> passed/exact_quote", () => {
    const item = { ...base, type: "digest" as const, claim_text: "key finding", evidence_quote: "key finding" };
    const v = validatePrepItem(item, [ev("the key finding was clear")]);
    expect(v).toEqual({ validationStatus: "passed", supportKind: "exact_quote", reason: expect.any(String) });
  });
  it("prose item with a quote that does NOT match evidence -> failed", () => {
    expect(validatePrepItem({ ...base, type: "qa" as const, evidence_quote: "absent phrase" }, [ev("unrelated text")]).validationStatus).toBe("failed");
  });
});

describe("validatePrepItem L3 numeric", () => {
  it("passes when value (and unit) appear in bound evidence", () => {
    const item = { ...base, type: "key_number" as const, value_numeric: 81.3, unit: "%" };
    const v = validatePrepItem(item, [ev("accuracy reached 81.3% on the test set")]);
    expect(v).toEqual({ validationStatus: "passed", supportKind: "numeric", reason: expect.any(String) });
  });
  it("fails when the number is absent from evidence", () => {
    const item = { ...base, type: "key_number" as const, value_numeric: 99, unit: null };
    const v = validatePrepItem(item, [ev("no such figure here")]);
    expect(v.validationStatus).toBe("failed");
    expect(v.supportKind).toBe("numeric");
  });
  it("fails when the value matches but the unit does not", () => {
    const item = { ...base, type: "key_number" as const, value_numeric: 5, unit: "kg" };
    const v = validatePrepItem(item, [ev("5 metres long")]);
    expect(v.validationStatus).toBe("failed");
  });
  it("does NOT match a value as a substring of a larger number (5 vs 1500)", () => {
    const item = { ...base, type: "key_number" as const, value_numeric: 5, unit: null };
    expect(validatePrepItem(item, [ev("the figure was 1500")]).validationStatus).toBe("failed");
  });
  it("matches across trailing-zero formatting (81.3 vs 81.30)", () => {
    const item = { ...base, type: "key_number" as const, value_numeric: 81.3, unit: "%" };
    expect(validatePrepItem(item, [ev("reported 81.30% accuracy")]).validationStatus).toBe("passed");
  });
  it("matches comma-grouped thousands (8130 vs 8,130)", () => {
    const item = { ...base, type: "key_number" as const, value_numeric: 8130, unit: null };
    expect(validatePrepItem(item, [ev("8,130 sentences were used")]).validationStatus).toBe("passed");
  });
});

describe("validatePrepItem verdict matrix (all 6 types)", () => {
  it("prose types (digest/qa/hostile/theory_card) with evidence + no exact-claim quote -> needs_review/existence", () => {
    for (const type of ["digest", "qa", "hostile", "theory_card"] as const) {
      expect(validatePrepItem({ ...base, type }, [ev("supporting passage")])).toEqual({
        validationStatus: "needs_review",
        supportKind: "existence",
        reason: expect.any(String),
      });
    }
  });
  it("key_number: passed when the number matches, failed when it does not", () => {
    expect(validatePrepItem({ ...base, type: "key_number", value_numeric: 7 }, [ev("the value 7 appears")]).validationStatus).toBe("passed");
    expect(validatePrepItem({ ...base, type: "key_number", value_numeric: 7 }, [ev("no number")]).validationStatus).toBe("failed");
  });
  it("citation_card: passed when quote matches, failed when missing or unmatched", () => {
    expect(validatePrepItem({ ...base, type: "citation_card", evidence_quote: "cited line" }, [ev("a cited line here")]).validationStatus).toBe("passed");
    expect(validatePrepItem({ ...base, type: "citation_card", evidence_quote: "x" }, [ev("y")]).validationStatus).toBe("failed");
    expect(validatePrepItem({ ...base, type: "citation_card" }, [ev("y")]).validationStatus).toBe("failed");
  });
  it("only `passed` is verified-eligible", () => {
    expect(validatePrepItem(base, [ev("prose")]).validationStatus).toBe("needs_review");
  });
});
