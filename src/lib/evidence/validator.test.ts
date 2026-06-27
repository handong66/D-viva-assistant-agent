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
  it("does NOT match a unit as a prefix of another unit token (m vs mg)", () => {
    const item = { ...base, type: "key_number" as const, value_numeric: 5, unit: "m" };
    expect(validatePrepItem(item, [ev("the dose was 5 mg")]).validationStatus).toBe("failed");
  });
  it("does NOT match a unit as a prefix of a longer word (m vs metres)", () => {
    const item = { ...base, type: "key_number" as const, value_numeric: 5, unit: "m" };
    expect(validatePrepItem(item, [ev("the rod is 5 metres long")]).validationStatus).toBe("failed");
  });
  it("matches a unit when the unit token is bounded", () => {
    const item = { ...base, type: "key_number" as const, value_numeric: 5, unit: "m" };
    expect(validatePrepItem(item, [ev("the rod is 5 m long")]).validationStatus).toBe("passed");
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

describe("validator hardening", () => {
  const ev = (text: string) => [{ id: "e1", text }];

  // A3: trivial quotes rejected
  it("rejects trivial-length quote", () => {
    // claim: exact_quote with a sub-8-char match should NOT verify
    const result = validatePrepItem(
      { ...base, type: "citation_card", claim_text: "fig", evidence_quote: "fig" },
      ev("see fig"),
    );
    expect(result.validationStatus).not.toBe("passed");
  });

  it("passes substantial citation quote", () => {
    const result = validatePrepItem(
      {
        ...base,
        type: "citation_card",
        claim_text: "results show improvement",
        evidence_quote: "results show improvement",
      },
      ev("The results show improvement in all metrics."),
    );
    expect(result.validationStatus).toBe("passed");
  });

  // A4: numeric parsing correctness
  it("passes negative decimal -0.42", () => {
    const result = validatePrepItem(
      { ...base, type: "key_number", claim_text: "-0.42", value_numeric: -0.42 },
      ev("correlation of -0.42 was found"),
    );
    expect(result.validationStatus).toBe("passed");
  });

  it("passes scientific notation 1e-5", () => {
    const result = validatePrepItem(
      { ...base, type: "key_number", claim_text: "1e-5", value_numeric: 1e-5 },
      ev("threshold 1e-5 applied"),
    );
    expect(result.validationStatus).toBe("passed");
  });

  it("passes comma-formatted 8,130", () => {
    const result = validatePrepItem(
      { ...base, type: "key_number", claim_text: "8130", value_numeric: 8130 },
      ev("sample size 8,130 participants"),
    );
    expect(result.validationStatus).toBe("passed");
  });

  it("passes percentage 81.3 with unit %", () => {
    const result = validatePrepItem(
      { ...base, type: "key_number", claim_text: "81.3", value_numeric: 81.3, unit: "%" },
      ev("accuracy 81.3% was achieved"),
    );
    expect(result.validationStatus).toBe("passed");
  });

  it("rejects version string 1.2.3", () => {
    const result = validatePrepItem(
      { ...base, type: "key_number", claim_text: "1.2.3", value_numeric: 1.2 },
      ev("version 1.2.3 released"),
    );
    expect(result.validationStatus).not.toBe("passed");
  });

  it("does not extract -9 from MMP-9 as a numeric match", () => {
    const result = validatePrepItem(
      { ...base, type: "key_number", claim_text: "-9", value_numeric: -9 },
      ev("enzyme MMP-9 was measured"),
    );
    expect(result.validationStatus).not.toBe("passed");
  });

  it("rejects a spaced numeric range (12 -15 → -15) but still passes a real negative", () => {
    expect(
      validatePrepItem({ ...base, type: "key_number", claim_text: "-15", value_numeric: -15 }, ev("pages 12 -15 inclusive")).validationStatus,
    ).not.toBe("passed"); // "-15" follows a digit (ignoring spaces) → range, not a sign
    expect(
      validatePrepItem({ ...base, type: "key_number", claim_text: "-0.42", value_numeric: -0.42 }, ev("the coefficient was -0.42 overall")).validationStatus,
    ).toBe("passed"); // preceded by a letter+space → genuine negative
  });

  it("rejects a glued numeric range 12-15", () => {
    expect(
      validatePrepItem({ ...base, type: "key_number", claim_text: "15", value_numeric: 15 }, ev("see pages 12-15 today")).validationStatus,
    ).not.toBe("passed");
  });

  it("rejects invalid comma grouping 81,3 (not 813)", () => {
    expect(
      validatePrepItem({ ...base, type: "key_number", claim_text: "813", value_numeric: 813 }, ev("ratio 81,3 reported")).validationStatus,
    ).not.toBe("passed");
  });

  it("passes scientific 1.2e+3 (= 1200)", () => {
    expect(
      validatePrepItem({ ...base, type: "key_number", claim_text: "1200", value_numeric: 1200 }, ev("scaled by 1.2e+3 overall")).validationStatus,
    ).toBe("passed");
  });

  it("still passes standalone -0.42 after boundary guard", () => {
    const result = validatePrepItem(
      { ...base, type: "key_number", claim_text: "-0.42", value_numeric: -0.42 },
      ev("value of -0.42 recorded"),
    );
    expect(result.validationStatus).toBe("passed");
  });
});
