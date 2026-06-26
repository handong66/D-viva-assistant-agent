export const VALIDATOR_VERSION = "1";

export type PrepItemType = "digest" | "key_number" | "qa" | "hostile" | "theory_card" | "citation_card";
export type SupportKind = "existence" | "exact_quote" | "numeric" | "llm_suggested";
export type ValidationStatus = "passed" | "needs_review" | "failed";

export type PrepItemInput = {
  type: PrepItemType;
  claim_text: string | null;
  evidence_quote: string | null;
  value_numeric: number | null;
  unit: string | null;
};
export type EvidenceText = { id: string; text: string };
export type Verdict = { validationStatus: ValidationStatus; supportKind: SupportKind; reason: string };

export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/­/g, "") // soft hyphen
    .replace(/[‘’]/g, "'") // curly single quotes
    .replace(/[“”]/g, '"') // curly double quotes
    .replace(/[‐-―]/g, "-") // hyphens/dashes
    .toLowerCase()
    .replace(/\s+/g, " ") // \s matches NBSP too
    .trim();
}

function fail(reason: string, supportKind: SupportKind): Verdict {
  return { validationStatus: "failed", supportKind, reason };
}
function pass(supportKind: SupportKind, reason: string): Verdict {
  return { validationStatus: "passed", supportKind, reason };
}
function review(supportKind: SupportKind, reason: string): Verdict {
  return { validationStatus: "needs_review", supportKind, reason };
}
function quoteMatches(quote: string, bound: EvidenceText[]): boolean {
  const q = normalize(quote);
  return q.length > 0 && bound.some((e) => normalize(e.text).includes(q));
}

const NUM_EPS = 1e-9;
// Parse one number token to a Number, stripping thousands-grouping commas (e.g. 8,130 -> 8130).
// Returns null for anything that isn't a plain integer/decimal after cleaning (e.g. "81,3", "1.2.3").
function parseNumToken(tok: string): number | null {
  const cleaned = tok.replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function numericMatches(value: number, unit: string | null, bound: EvidenceText[]): boolean {
  const wantUnit = unit && unit.trim() ? normalize(unit) : null;
  const re = /\d[\d.,]*\d|\d/g; // whole number tokens; no \s so separate numbers don't merge
  for (const e of bound) {
    const t = normalize(e.text);
    for (const m of t.matchAll(re)) {
      const n = parseNumToken(m[0]);
      if (n === null || Math.abs(n - value) >= NUM_EPS) continue; // value compared numerically, not as substring
      if (!wantUnit) return true;
      const rest = t.slice((m.index ?? 0) + m[0].length).replace(/^\s+/, "");
      if (rest.startsWith(wantUnit)) return true; // unit must sit right after the number token
    }
  }
  return false;
}

export function validatePrepItem(item: PrepItemInput, bound: EvidenceText[]): Verdict {
  // L1 — existence/cardinality
  const mandatory = item.type === "key_number" || item.type === "citation_card";
  if (bound.length === 0) {
    if (mandatory) return fail(`${item.type} requires bound evidence`, item.type === "key_number" ? "numeric" : "exact_quote");
    return { validationStatus: "needs_review", supportKind: "existence", reason: "no bound evidence" };
  }

  if (item.type === "key_number") {
    if (item.value_numeric === null) return fail("key_number missing value_numeric", "numeric");
    return numericMatches(item.value_numeric, item.unit, bound)
      ? pass("numeric", "value (and unit) found in bound evidence")
      : fail("value not found in bound evidence", "numeric");
  }

  // L2 — exact quote. Only the claim itself being provable yields `passed`.
  if (item.type === "citation_card") {
    if (!item.evidence_quote) return fail("citation_card requires an evidence_quote", "exact_quote");
    return quoteMatches(item.evidence_quote, bound)
      ? pass("exact_quote", "citation quote found in evidence")
      : fail("citation quote not found in evidence", "exact_quote");
  }
  if (item.evidence_quote) {
    if (!quoteMatches(item.evidence_quote, bound)) {
      return fail("evidence_quote not found in bound evidence", "exact_quote");
    }
    // a matched quote only certifies the claim when the claim IS that quote
    if (item.claim_text && normalize(item.claim_text) === normalize(item.evidence_quote)) {
      return pass("exact_quote", "claim is verbatim the matched quote");
    }
    return review("existence", "quote matches but claim is a paraphrase — not deterministically verified");
  }
  return review("existence", "bound evidence present; prose claim not deterministically provable");
}
