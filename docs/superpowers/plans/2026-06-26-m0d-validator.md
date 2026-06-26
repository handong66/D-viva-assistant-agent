# M0d Leveled Evidence Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement task-by-task. Steps use checkbox (`- [ ]`) syntax. This milestone is executed under the Claude↔Codex 互评 workflow: **Codex implements each task via `codex:codex-rescue` (--write); Claude runs the tests Codex can't, reviews, and commits.**

**Goal:** A deterministic, leveled validator that decides whether a generated `prep_item` may be marked `verified` — and only lets it when the claim is *provable* from its bound evidence (never on model say-so). This is the enforcement half of spec §10/§11 (P0-2).

**Architecture:** A **pure** validator (`src/lib/evidence/validator.ts`) takes a `prep_item` plus its already-fetched bound `evidence_unit` rows and returns `{ validationStatus, supportKind, reason }`. No DB, no LLM → fully unit-testable. A thin repository service fetches the bound evidence and persists the result. Determinism: only L1–L3 (existence/cardinality, exact-quote, numeric) can yield `passed`; everything unprovable stays `needs_review`. **L4 (LLM-assisted suggestion) is deferred to M2** (it is advisory-only and belongs with prep-pack generation).

**Tech Stack:** TypeScript (strict) · better-sqlite3 · vitest. Builds on M0b schema (`prep_item`, `prep_item_evidence`, `evidence_unit`) and the field set: `type`, `claim_text`, `evidence_quote`, `value_numeric`, `unit`, `support_kind`, `validation_status`, `validator_version`.

**Spec:** `docs/superpowers/specs/2026-06-23-viva-assistant-generic-design.md` §6 (落库前校验器, validator levels), §10 (prep-pack), §11 (judge/examiner evidence binding).

**Scope:** pure leveled validator (L1–L3) + result model + repository fetch/persist. **Out of scope:** L4 LLM advisory (→ M2), prep-pack generation (→ M2), ingest (→ M1), examiner/judge (→ M3), UI.

---

## Validation rules (the contract)

`VALIDATOR_VERSION = "1"`. **Core principle (Codex P1-1): `passed`/`verified` is allowed ONLY when the thing checked deterministically IS the item's claim** — not merely that some quoted/numeric string appears in evidence. So only `key_number` (the number is the claim) and `citation_card` (the quote is the claim) can normally reach `passed`; a prose item reaches `passed` only if its `claim_text` is *verbatim* the matched quote.

`normalize(s)` (applied to both sides before matching): **`NFKC`** → drop soft hyphens (`­`) → unify curly quotes (`‘’`→`'`, `“”`→`"`) and dashes (`‐-―`→`-`) → lowercase → collapse whitespace (incl. NBSP) to one space → trim. (Codex P2 — robust for PDF-derived evidence.)

Given a `prep_item` and its bound `evidence_unit[]` (`bound`):

- **L1 — existence/cardinality.** `bound.length >= 1`. For `type ∈ {key_number, citation_card}` evidence is mandatory; if absent → `failed`.
- **L2 — exact quote.** A quote *matches* when `normalize(evidence_quote)` is a non-empty substring of some `normalize(bound.text)`.
- **L3 — numeric.** Tokenize numbers in each `normalize(bound.text)`, parse each token to a Number (strip thousands separators; tolerate trailing-zero formatting via epsilon), and compare to `value_numeric`; if `unit` is set it must be the **next token after** the matched number — optionally separated by whitespace (so both `81.3%` and `5 kg` match, but `5 metres`≠unit `kg`). (Codex P1-2 — no substring false positives like `5`⊂`1500`, and `81.3`≡`81.30`.)

Verdict (`validationStatus`, `supportKind`):
- `key_number`: L1 then **L3 only**. Number (+unit) matched → `passed`/`numeric`. Evidence present but not matched → `failed`/`numeric`. No evidence → `failed`/`numeric`. (The quote, if any, is not what certifies a number.)
- `citation_card`: must carry an `evidence_quote`. L1 then L2. Matched → `passed`/`exact_quote`. Quote unmatched, or missing quote/evidence → `failed`/`exact_quote`.
- `digest`/`qa`/`hostile`/`theory_card`: `passed`/`exact_quote` **only if** `normalize(claim_text) === normalize(evidence_quote)` *and* that quote matches bound evidence (the claim is verbatim the source). Otherwise, with ≥1 evidence → `needs_review`/`existence`; a provided-but-unmatched quote → `failed`/`exact_quote`. Semantic paraphrase support is L4/human, never a deterministic `verified`.

`passed` ⇒ `prep_item.status = 'verified'`. `needs_review` ⇒ `needs_review`. `failed` ⇒ `unsafe`. Persistence (Task 5) maps the verdict onto `validation_status` + `status` and clears `verified_at` unless `passed`.

---

## File Structure

- `src/lib/evidence/validator.ts` — pure validator + helpers (Tasks 1–4)
- `src/lib/evidence/validator.test.ts` — pure unit tests (Tasks 1–4)
- `src/db/repository.ts` — add `getBoundEvidence(db, prepItemId)` + `applyValidation(db, prepItemId, verdict)` (Task 5)
- `src/db/repository.validation.test.ts` — integration tests (Task 5)

---

### Task 1: Result types + L1 existence/cardinality

**Files:** Create `src/lib/evidence/validator.ts`, `src/lib/evidence/validator.test.ts`

- [ ] **Step 1: Failing test** — `src/lib/evidence/validator.test.ts`:
```ts
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
```

- [ ] **Step 2: Run — FAIL.** `npx vitest run src/lib/evidence/validator.test.ts`

- [ ] **Step 3: Implement** — `src/lib/evidence/validator.ts`:
```ts
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

export function validatePrepItem(item: PrepItemInput, bound: EvidenceText[]): Verdict {
  // L1 — existence/cardinality
  const mandatory = item.type === "key_number" || item.type === "citation_card";
  if (bound.length === 0) {
    if (mandatory) return fail(`${item.type} requires bound evidence`, item.type === "key_number" ? "numeric" : "exact_quote");
    return { validationStatus: "needs_review", supportKind: "existence", reason: "no bound evidence" };
  }
  // Type-specific levels are added in later tasks; default for now:
  return { validationStatus: "needs_review", supportKind: "existence", reason: "L1 only" };
}
```

- [ ] **Step 4: Run — PASS.** Then commit:
```bash
git add src/lib/evidence/validator.ts src/lib/evidence/validator.test.ts
git commit -m "feat(m0d): evidence validator L1 existence/cardinality + types"
```

---

### Task 2: L2 exact-quote matching

**Files:** Modify `src/lib/evidence/validator.ts`, `src/lib/evidence/validator.test.ts`

- [ ] **Step 1: Failing tests** — add to `validator.test.ts`:
```ts
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
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — add helpers + the L2 block. Add near `fail`:
```ts
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
```
In `validatePrepItem`, after the L1 block, replace the default tail with the L2 logic (the `key_number` numeric branch from Task 3 is inserted *before* this, so key_number never reaches here):
```ts
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
```

- [ ] **Step 4: Run — PASS.** Commit:
```bash
git add src/lib/evidence/validator.ts src/lib/evidence/validator.test.ts
git commit -m "feat(m0d): validator L2 exact-quote matching"
```

---

### Task 3: L3 numeric matching for key_number

**Files:** Modify `src/lib/evidence/validator.ts`, `src/lib/evidence/validator.test.ts`

- [ ] **Step 1: Failing tests** — add:
```ts
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
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — add the numeric helper and a `key_number` branch in `validatePrepItem` (place the key_number branch BEFORE the generic L2 quote block, since key_number is numeric-validated):
```ts
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
```
Insert in `validatePrepItem`, immediately after the L1 block (before the L2 block from Task 2):
```ts
  if (item.type === "key_number") {
    if (item.value_numeric === null) return fail("key_number missing value_numeric", "numeric");
    return numericMatches(item.value_numeric, item.unit, bound)
      ? pass("numeric", "value (and unit) found in bound evidence")
      : fail("value not found in bound evidence", "numeric");
  }
```
> Known M0d limitation (acceptable; flag for the gate): European decimal comma ("81,3" meaning 81.3) is treated as non-numeric and won't match — academic English uses period decimals. Revisit if ingest surfaces comma-decimal sources.

- [ ] **Step 4: Run — PASS.** Commit:
```bash
git add src/lib/evidence/validator.ts src/lib/evidence/validator.test.ts
git commit -m "feat(m0d): validator L3 numeric matching for key_number"
```

---

### Task 4: Orchestration sanity (full-matrix tests)

**Files:** Modify `src/lib/evidence/validator.test.ts` (no new prod code expected; this task hardens the contract)

- [ ] **Step 1: Add a verdict-matrix test** covering each type at each outcome:
```ts
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
```

- [ ] **Step 2: Run — PASS** (if any case fails, fix `validator.ts`; the matrix is the source of truth). Commit:
```bash
git add src/lib/evidence/validator.test.ts src/lib/evidence/validator.ts
git commit -m "test(m0d): validator verdict matrix across all prep_item types"
```

---

### Task 5: Repository integration — fetch bound evidence + persist verdict

**Files:** Modify `src/db/repository.ts`; create `src/db/repository.validation.test.ts`

- [ ] **Step 1: Failing test** — `src/db/repository.validation.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { bindPrepEvidence, getBoundEvidence, applyValidation } from "./repository";
import { validatePrepItem } from "../lib/evidence/validator";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','A','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,text,char_count,hash) VALUES ('c1','t1',0,'x',1,'h');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash)
      VALUES ('e1','t1','c1',0,20,'accuracy was 81.3%','h');
    INSERT INTO prep_item (id,thesis_id,type,title,value_numeric,unit,status,validation_status,validator_version,source)
      VALUES ('p1','t1','key_number','Acc',81.3,'%','needs_review','needs_review','0','generated');
  `);
}

describe("validation repository", () => {
  it("getBoundEvidence returns the bound evidence text", () => {
    const db = makeTestDb(); seed(db);
    bindPrepEvidence(db, "p1", ["e1"]);
    expect(getBoundEvidence(db, "p1")).toEqual([{ id: "e1", text: "accuracy was 81.3%" }]);
    db.close();
  });

  it("applyValidation persists status=verified + validation_status=passed for a proven key_number", () => {
    const db = makeTestDb(); seed(db);
    bindPrepEvidence(db, "p1", ["e1"]);
    const item = db.prepare("SELECT type,claim_text,evidence_quote,value_numeric,unit FROM prep_item WHERE id='p1'").get() as any;
    const verdict = validatePrepItem(item, getBoundEvidence(db, "p1"));
    applyValidation(db, "p1", verdict);
    const row = db.prepare("SELECT status, validation_status, support_kind, validator_version FROM prep_item WHERE id='p1'").get();
    expect(row).toEqual({ status: "verified", validation_status: "passed", support_kind: "numeric", validator_version: "1" });
    db.close();
  });

  it("a failed verdict sets status=unsafe", () => {
    const db = makeTestDb(); seed(db);
    // bind evidence that does NOT contain the number
    db.exec("UPDATE evidence_unit SET text='no figure' WHERE id='e1'");
    bindPrepEvidence(db, "p1", ["e1"]);
    const item = db.prepare("SELECT type,claim_text,evidence_quote,value_numeric,unit FROM prep_item WHERE id='p1'").get() as any;
    applyValidation(db, "p1", validatePrepItem(item, getBoundEvidence(db, "p1")));
    expect((db.prepare("SELECT status FROM prep_item WHERE id='p1'").get() as any).status).toBe("unsafe");
    db.close();
  });

  it("clears verified_at when a previously-verified item is re-validated down (P1-3)", () => {
    const db = makeTestDb(); seed(db);
    bindPrepEvidence(db, "p1", ["e1"]);
    applyValidation(db, "p1", { validationStatus: "passed", supportKind: "numeric", reason: "x" });
    expect((db.prepare("SELECT verified_at FROM prep_item WHERE id='p1'").get() as any).verified_at).not.toBeNull();
    applyValidation(db, "p1", { validationStatus: "needs_review", supportKind: "existence", reason: "x" });
    const row = db.prepare("SELECT status, verified_at FROM prep_item WHERE id='p1'").get() as any;
    expect(row.status).toBe("needs_review");
    expect(row.verified_at).toBeNull();
    db.close();
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — append to `src/db/repository.ts` (import the types from the validator):
```ts
import { VALIDATOR_VERSION, type EvidenceText, type Verdict } from "../lib/evidence/validator";

export function getBoundEvidence(db: DB, prepItemId: string): EvidenceText[] {
  return db
    .prepare(
      `SELECT eu.id AS id, eu.text AS text
         FROM prep_item_evidence pie
         JOIN evidence_unit eu ON eu.id = pie.evidence_unit_id
        WHERE pie.prep_item_id = ?
        ORDER BY eu.id`,
    )
    .all(prepItemId) as EvidenceText[];
}

const STATUS_FOR: Record<Verdict["validationStatus"], "verified" | "needs_review" | "unsafe"> = {
  passed: "verified",
  needs_review: "needs_review",
  failed: "unsafe",
};

export function applyValidation(db: DB, prepItemId: string, verdict: Verdict): void {
  db.prepare(
    `UPDATE prep_item
        SET status = @status,
            validation_status = @validation_status,
            support_kind = @support_kind,
            validator_version = @validator_version,
            verified_at = CASE WHEN @validation_status = 'passed' THEN datetime('now') ELSE NULL END,
            updated_at = datetime('now')
      WHERE id = @id`,
  ).run({
    id: prepItemId,
    status: STATUS_FOR[verdict.validationStatus],
    validation_status: verdict.validationStatus,
    support_kind: verdict.supportKind,
    validator_version: VALIDATOR_VERSION,
  });
}
```
> Place the `import` at the top with the existing imports. This is `db` importing a TYPE from `lib/evidence/validator` — acceptable (validator is pure domain logic with no `db`/`ai` dependency; no cycle). If a reviewer prefers strict layering, move `EvidenceText`/`Verdict` to a shared `src/lib/evidence/types.ts`.

- [ ] **Step 4: Run — PASS.** Then `npm run check`. Commit:
```bash
git add src/db/repository.ts src/db/repository.validation.test.ts
git commit -m "feat(m0d): repository getBoundEvidence + applyValidation (verdict -> status)"
```

---

## Codex 互评 Gate (M0d)

- [ ] `npm run check` green + `next build` smoke.
- [ ] Fresh Codex review (read-only, via `codex:codex-rescue`): normalization correctness; the `db`→`lib/evidence` type import (cycle? layering?); numeric matching false-positives (e.g. "5" matching inside "1500" — is substring matching too loose?); citation_card/quote rules; that ONLY `passed` maps to `verified`; any red-line/scope issue.
- [ ] Verify each finding (grep/read); reconcile until both + tests agree. Merge to `main`. Then M1 (ingest).

## Self-Review Notes (author)

- **Spec coverage:** §6 leveled validator (L1–L3 deterministic; L4 deferred to M2), only-provable→verified. Persistence maps verdict→`status`/`validation_status`/`support_kind`/`validator_version`.
- **Round-2 (Codex plan review applied):** P1-1 — only `key_number` (numeric) and `citation_card` (quote) reach `passed`; prose items need `claim_text` *verbatim* == matched quote, else `needs_review` (a matched-but-paraphrased quote is not a `verified` gate). P1-2 — numeric is **token-parsed and compared as a number** (no `5`⊂`1500`; tolerant of trailing-zero `81.30` and comma grouping `8,130`; unit must be adjacent). P1-3 — `verified_at` cleared on any non-`passed` re-validation. P2 — `normalize` adds NFKC + soft-hyphen/curly-quote/dash handling. Known limitation: European decimal comma (`81,3`) not matched (academic English uses period decimals).
- **Deferred:** L4 LLM advisory (→ M2 prep-pack), the generation that produces `prep_item`s (→ M2).
