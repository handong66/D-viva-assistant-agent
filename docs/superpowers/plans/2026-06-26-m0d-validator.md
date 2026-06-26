# M0d Leveled Evidence Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement task-by-task. Steps use checkbox (`- [ ]`) syntax. This milestone is executed under the Claude↔Codex 互评 workflow: **Codex implements each task via `codex:codex-rescue` (--write); Claude runs the tests Codex can't, reviews, and commits.**

**Goal:** A deterministic, leveled validator that decides whether a generated `prep_item` may be marked `verified` — and only lets it when the claim is *provable* from its bound evidence (never on model say-so). This is the enforcement half of spec §10/§11 (P0-2).

**Architecture:** A **pure** validator (`src/lib/evidence/validator.ts`) takes a `prep_item` plus its already-fetched bound `evidence_unit` rows and returns `{ validationStatus, supportKind, reason }`. No DB, no LLM → fully unit-testable. A thin repository service fetches the bound evidence and persists the result. Determinism: only L1–L3 (existence/cardinality, exact-quote, numeric) can yield `passed`; everything unprovable stays `needs_review`. **L4 (LLM-assisted suggestion) is deferred to M2** (it is advisory-only and belongs with prep-pack generation).

**Tech Stack:** TypeScript (strict) · better-sqlite3 · vitest. Builds on M0b schema (`prep_item`, `prep_item_evidence`, `evidence_unit`) and the field set: `type`, `claim_text`, `evidence_quote`, `value_numeric`, `unit`, `support_kind`, `validation_status`, `validator_version`.

**Spec:** `docs/superpowers/specs/2026-06-23-viva-assistant-generic-design.md` §6 (落库前校验器, validator levels), §10 (prep-pack), §11 (judge/examiner evidence binding).

**Scope:** pure leveled validator (L1–L3) + result model + repository fetch/persist. **Out of scope:** L4 LLM advisory (→ M2), prep-pack generation (→ M2), ingest (→ M1), examiner/judge (→ M3), UI.

---

## Validation rules (the contract)

`VALIDATOR_VERSION = "1"`. Text matching normalizes both sides: lowercase, collapse all whitespace runs to a single space, trim.

Given a `prep_item` and its bound `evidence_unit[]` (`bound`):

- **L1 — existence/cardinality.** `bound.length >= 1`. For `type ∈ {key_number, citation_card}` evidence is mandatory (min 1); if absent → `failed`.
- **L2 — exact quote.** If `evidence_quote` is set, its normalized form must be a substring of some bound evidence's normalized `text`.
- **L3 — numeric.** For `type = key_number`: `value_numeric` (rendered) and, when present, `unit` must both appear in some bound evidence's normalized text.

Verdict (`validationStatus`, `supportKind`):
- `key_number`: L1 then L3. Pass → `passed`/`numeric`. Evidence present but number not found → `failed`/`numeric`. No evidence → `failed`.
- `citation_card`: L1 then L2 (a citation_card must carry an `evidence_quote`). Pass → `passed`/`exact_quote`. Quote not found → `failed`/`exact_quote`. No evidence/quote → `failed`.
- any type with an `evidence_quote` set: L2 applies; matched → `passed`/`exact_quote`; set but unmatched → `failed`/`exact_quote`.
- `digest`/`qa`/`hostile`/`theory_card` with no exact quote: L1 only → `needs_review`/`existence` (semantic support is not deterministically provable; that's L4/human, not a `verified` gate).

`passed` ⇒ eligible for `prep_item.status = 'verified'`. `needs_review` ⇒ `status` stays/needs_review. `failed` ⇒ `status = 'unsafe'`. The validator returns the verdict; persistence (Task 5) maps it onto `validation_status` + `status`.

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
  return s.toLowerCase().replace(/\s+/g, " ").trim();
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
  it("passes when evidence_quote is a normalized substring of bound text", () => {
    const item = { ...base, type: "citation_card" as const, evidence_quote: "Smith  2020 found X" };
    const v = validatePrepItem(item, [ev("As Smith 2020 found X in their study")]);
    expect(v).toEqual({ validationStatus: "passed", supportKind: "exact_quote", reason: expect.any(String) });
  });
  it("fails when evidence_quote is not found", () => {
    const item = { ...base, type: "citation_card" as const, evidence_quote: "not present" };
    const v = validatePrepItem(item, [ev("something else")]);
    expect(v.validationStatus).toBe("failed");
    expect(v.supportKind).toBe("exact_quote");
  });
  it("a digest WITH a matched quote upgrades to passed/exact_quote", () => {
    const item = { ...base, type: "digest" as const, evidence_quote: "key finding" };
    const v = validatePrepItem(item, [ev("the key finding was clear")]);
    expect(v).toEqual({ validationStatus: "passed", supportKind: "exact_quote", reason: expect.any(String) });
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — add the quote helper and wire it into `validatePrepItem` (replace the default tail). Add:
```ts
function quoteMatches(quote: string, bound: EvidenceText[]): boolean {
  const q = normalize(quote);
  return q.length > 0 && bound.some((e) => normalize(e.text).includes(q));
}
```
In `validatePrepItem`, after the L1 block, before the default return:
```ts
  // L2 — exact quote (applies whenever an evidence_quote is provided, mandatory for citation_card)
  if (item.type === "citation_card" && !item.evidence_quote) {
    return fail("citation_card requires an evidence_quote", "exact_quote");
  }
  if (item.evidence_quote) {
    return quoteMatches(item.evidence_quote, bound)
      ? { validationStatus: "passed", supportKind: "exact_quote", reason: "evidence_quote found in bound evidence" }
      : fail("evidence_quote not found in bound evidence", "exact_quote");
  }
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
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — add the numeric helper and a `key_number` branch in `validatePrepItem` (place the key_number branch BEFORE the generic L2 quote block, since key_number is numeric-validated):
```ts
function numericMatches(value: number, unit: string | null, bound: EvidenceText[]): boolean {
  // Render the value plainly; match against normalized evidence text. Unit (if any) must also appear.
  const valStr = String(value);
  return bound.some((e) => {
    const t = normalize(e.text);
    if (!t.includes(valStr)) return false;
    if (unit && unit.trim()) return t.includes(normalize(unit));
    return true;
  });
}
```
Insert in `validatePrepItem`, immediately after the L1 block:
```ts
  if (item.type === "key_number") {
    if (item.value_numeric === null) return fail("key_number missing value_numeric", "numeric");
    return numericMatches(item.value_numeric, item.unit, bound)
      ? { validationStatus: "passed", supportKind: "numeric", reason: "value (and unit) found in bound evidence" }
      : fail("value not found in bound evidence", "numeric");
  }
```

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
describe("validatePrepItem verdict matrix", () => {
  it("qa/hostile/theory_card with evidence but no quote -> needs_review/existence", () => {
    for (const type of ["qa", "hostile", "theory_card"] as const) {
      const v = validatePrepItem({ ...base, type }, [ev("supporting passage")]);
      expect(v).toEqual({ validationStatus: "needs_review", supportKind: "existence", reason: expect.any(String) });
    }
  });
  it("only `passed` is verified-eligible; needs_review and failed are not", () => {
    const passed = validatePrepItem({ ...base, type: "key_number", value_numeric: 7 }, [ev("the value 7 appears")]);
    const review = validatePrepItem(base, [ev("prose")]);
    const failed = validatePrepItem({ ...base, type: "key_number", value_numeric: 7 }, [ev("no number")]);
    expect(passed.validationStatus).toBe("passed");
    expect(review.validationStatus).toBe("needs_review");
    expect(failed.validationStatus).toBe("failed");
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
            verified_at = CASE WHEN @validation_status = 'passed' THEN datetime('now') ELSE verified_at END,
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
- **Known risk to flag for Codex:** numeric substring matching ("5" ⊂ "1500"). Mitigation candidates: match on word-boundary / token, or require the unit. The plan keeps it simple (substring + unit); the Codex gate should decide if that's strict enough for M0d or needs tokenization.
- **Deferred:** L4 LLM advisory (→ M2 prep-pack), the generation that produces `prep_item`s (→ M2).
