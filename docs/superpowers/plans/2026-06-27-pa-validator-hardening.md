# Polish A — Validator hardening + verified-honesty

> **老流程:** Codex implements per task; Claude runs the gate + reviews + commits, with a Codex design review before code and a milestone gate after. (Touches the P0-2 deterministic validator — the project's trust core — so it gets a milestone gate.)

**Goal:** Tighten the deterministic validator and make the `verified` badge honest about *what* it certifies. From the broad code review:
- **A3** — `quoteMatches` accepts a 1-character `evidence_quote` (only `q.length > 0`), so a trivial quote can `verify` a `citation_card`.
- **A4** — the numeric matcher can't parse signed/scientific values (`-0.42`, `1e-5`, p-values), so legitimate `key_number`s **false-fail**.
- **A1/A2** — `key_number`/`citation_card` reach `verified` by confirming only the number / the quote, while the materials card displays the LLM-written `title` + `claim_text` (which may over-state). Not a red-line breach (content is still evidence-bound), but the badge over-claims. Make it honest by surfacing `support_kind` so the badge says what was actually proven.

**Architecture:** A3/A4 are pure `validator.ts` changes (fully unit-testable). A1 surfaces the existing `support_kind` column through `getPrepItems` and qualifies the badge on `/materials` — no validation behavior change, no false downgrades.

**Tech Stack:** TypeScript (pure validator), better-sqlite3 (one extra SELECT column), Next 16 RSC, Tailwind, vitest.

> **Scope / non-goals:** keep `numericMatches`' `!wantUnit → true` (a unitless `key_number` validly matches its number in the BOUND evidence — the over-claim is in the displayed claim text, which A1's honesty badge addresses, not a number bug). Do NOT tighten `citation_card`/`key_number` to require the prose `claim_text` to be a verbatim quote — that would gut the verified set (paraphrased claims are the norm). The design review decides if A1's badge is sufficient or if more is wanted (see open question).

---

## Contracts

```ts
// src/lib/evidence/validator.ts — internal change only; signatures unchanged
// quoteMatches now requires a minimum normalized length; parseNumToken/token-regex accept sign + exponent.

// src/db/repository.ts
export type PrepItemRow = { id: string; type: string; title: string; claimText: string | null; status: string; validationStatus: string; supportKind: string | null };
```

## File structure

- **Modify** `src/lib/evidence/validator.ts` (+`src/lib/evidence/validator.test.ts`) — A3 + A4.
- **Modify** `src/db/repository.ts` — `getPrepItems` selects `support_kind`; `PrepItemRow` gains `supportKind`.
- **Modify** `src/app/materials/page.tsx` — qualify the verified badge with the support basis.

---

### Task 1: validator A3 (quote min-length) + A4 (signed/scientific numbers)

**Files:** Modify `src/lib/evidence/validator.ts`, `src/lib/evidence/validator.test.ts`

- [ ] **Step 1: Write the failing tests** — add a NEW `describe` block to the EXISTING `src/lib/evidence/validator.test.ts` (it already imports `describe/it/expect` + `validatePrepItem` at lines 1-5 — do NOT duplicate the imports; just add the block + a local `ev` helper):

```ts
// (imports already present at the top of the file)
const ev = (text: string) => [{ id: "e1", text }];

describe("validator hardening", () => {
  it("A3: a trivial (too-short) evidence_quote does not verify a citation_card", () => {
    const r = validatePrepItem({ type: "citation_card", claim_text: null, evidence_quote: "a", value_numeric: null, unit: null }, ev("a long sentence containing the letter a and much more."));
    expect(r.validationStatus).not.toBe("passed");
  });
  it("A3: a substantial citation quote still verifies", () => {
    const r = validatePrepItem({ type: "citation_card", claim_text: null, evidence_quote: "Bohr 1913 on spectra", value_numeric: null, unit: null }, ev("As we cite Bohr 1913 on spectra in chapter two."));
    expect(r.validationStatus).toBe("passed");
  });
  it("A4: a negative key_number value verifies against signed evidence", () => {
    const r = validatePrepItem({ type: "key_number", claim_text: null, evidence_quote: null, value_numeric: -0.42, unit: null }, ev("the correlation coefficient was -0.42 overall"));
    expect(r.validationStatus).toBe("passed");
  });
  it("A4: a scientific-notation p-value verifies", () => {
    const r = validatePrepItem({ type: "key_number", claim_text: null, evidence_quote: null, value_numeric: 1e-5, unit: null }, ev("significant at p = 1e-5 in the ablation"));
    expect(r.validationStatus).toBe("passed");
  });
  it("A4: existing plain/thousands/decimal matching is unchanged", () => {
    expect(validatePrepItem({ type: "key_number", claim_text: null, evidence_quote: null, value_numeric: 8130, unit: null }, ev("a total of 8,130 samples")).validationStatus).toBe("passed");
    expect(validatePrepItem({ type: "key_number", claim_text: null, evidence_quote: null, value_numeric: 81.3, unit: "%" }, ev("accuracy was 81.3% on the test set")).validationStatus).toBe("passed");
  });
  it("A4: a version-like token (1.2.3) is still a single REJECTED token — does not match 1.2", () => {
    const r = validatePrepItem({ type: "key_number", claim_text: null, evidence_quote: null, value_numeric: 1.2, unit: null }, ev("see figure 1.2.3 in the appendix"));
    expect(r.validationStatus).not.toBe("passed");
  });
  it("A4: a hyphen inside an identifier (MMP-9) does NOT verify a negative value, but a real signed value does", () => {
    expect(validatePrepItem({ type: "key_number", claim_text: null, evidence_quote: null, value_numeric: -9, unit: null }, ev("the protease MMP-9 was elevated")).validationStatus).not.toBe("passed");
    expect(validatePrepItem({ type: "key_number", claim_text: null, evidence_quote: null, value_numeric: -0.42, unit: null }, ev("the coefficient was -0.42 overall")).validationStatus).toBe("passed");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/evidence/validator.test.ts` — FAIL.

- [ ] **Step 3: Implement** — in `src/lib/evidence/validator.ts`:

A3 — add a min-length floor to `quoteMatches`:
```ts
const MIN_QUOTE_CHARS = 8; // a normalized quote shorter than this is too trivial to certify a citation
function quoteMatches(quote: string, bound: EvidenceText[]): boolean {
  const q = normalize(quote);
  return q.length >= MIN_QUOTE_CHARS && bound.some((e) => normalize(e.text).includes(q));
}
```

A4 — accept an optional sign + scientific exponent in both the parser and the tokenizer:
```ts
function parseNumToken(tok: string): number | null {
  const cleaned = tok.replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cleaned)) return null; // was ^\d+(\.\d+)?$
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
// in numericMatches, the token regex — LOOSE span, strict parser:
const re = /-?\d[\d.,eE+-]*\d|-?\d/g; // was /\d[\d.,]*\d|\d/g
```
And INSIDE the `for (const m of t.matchAll(re))` loop, BEFORE `parseNumToken`, reject a leading `-` that is really a hyphen inside an identifier/range — `normalize` maps en/em dashes to `-`, so `MMP-9` becomes `mmp-9` and would tokenize as `-9`:
```ts
const idx = m.index ?? 0;
if (m[0].startsWith("-") && idx > 0 && /[a-z0-9]/.test(t[idx - 1] ?? "")) continue; // hyphen in "MMP-9", not a sign
```

> **Loose tokenizer + strict `parseNumToken`** (deliberate): the regex grabs the maximal number-ish span (sign, decimal, exponent), then `parseNumToken` validates strictly. This *preserves* the original rejections — `1.2.3` and `12-15` are still captured as a SINGLE token that fails the strict test (so they don't spuriously match `1.2` or `15`) — while now also accepting `-0.42` / `1e-5`. The unit-suffix check (`rest.startsWith(wantUnit)` on `t.slice(m.index + m[0].length)`) stays correct because `m[0]` is the whole number token.

- [ ] **Step 4: Run to verify it passes** — PASS (new + existing).
- [ ] **Step 5: Commit** — `git commit -m "feat(pa): validator hardening — quote min-length + signed/scientific numbers"`

---

### Task 2: A1 — surface `support_kind` so the verified badge states its basis

**Files:** Modify `src/db/repository.ts`, `src/app/materials/page.tsx`

- [ ] **Step 1: Surface support_kind** — in `src/db/repository.ts`:
  - Add `supportKind: string | null` to `PrepItemRow`.
  - In `getPrepItems`, add `support_kind` to the SELECT and the row type, and map `supportKind: r.support_kind`.

- [ ] **Step 2: Qualify the badge** — in `src/app/materials/page.tsx`'s `PrepItem`, show what `verified` rests on, so the badge never implies the prose claim was checked:

```tsx
const SUPPORT_LABEL: Record<string, string> = { numeric: "number", exact_quote: "quote", existence: "", llm_suggested: "" };
// in the badge area, when item.status === "verified":
const basis = SUPPORT_LABEL[item.supportKind ?? ""] ?? "";
// render the status badge text as: `verified${basis ? ` · ${basis}` : ""}` (and a one-line note for verified key_number/citation_card)
```
Render (replace the status-badge `<span>` text for verified items, keep the existing badge colour):
```tsx
<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge[item.status] ?? statusBadge.draft}`}>
  {item.status === "verified" && basis ? `verified · ${basis}` : item.status.replaceAll("_", " ")}
</span>
```
And, for `key_number`/`citation_card`, add a muted one-liner under the claim clarifying scope:
```tsx
{item.status === "verified" && (item.type === "key_number" || item.type === "citation_card") ? (
  <p className="mt-1 text-xs text-zinc-400">Verified: the {basis || "evidence"} is grounded in your thesis. The surrounding wording is AI-generated.</p>
) : null}
```

- [ ] **Step 3: Typecheck + build** — `npx tsc --noEmit` (exit 0). (Claude runs `npm run build`.)
- [ ] **Step 4: Commit** — `git commit -m "feat(pa): qualify the verified badge with its support basis (support_kind)"`

---

## Gate + smoke (Claude)

```bash
npm run check   # validator hardening tests + existing suite
npm run build   # /materials Dynamic
```
Dev smoke (AI off, inject prep items): a verified `key_number` shows "verified · number" + the scope note; a verified `citation_card` shows "verified · quote"; a `digest` shows plain "verified"/"needs review". Inject a `key_number` with `value_numeric=-0.42` bound to evidence containing "-0.42" → it validates (would have failed before).

## Red lines

1. **Stricter, never looser (red line #1):** A3 only *raises* the bar for `verify` (a trivial quote no longer passes); A4 lets a legitimately-grounded signed/scientific number pass that previously false-failed (toward `needs_review`/`unsafe`) — both move toward more honest verification, never toward verifying something ungrounded.
2. **No validation behavior change in A1:** A1 only reads/displays the existing `support_kind`; it does not alter any verdict. The honesty is in the badge wording.
3. **Pure + deterministic:** A3/A4 stay pure (no AI, no IO); fully unit-tested.

## Self-review

- **A2 deliberately folded into A1:** a unitless `key_number` still validly matches its number in the *bound* evidence; the over-claim risk is the displayed claim text, which the A1 badge ("verified · number" + scope note) addresses honestly without downgrading legitimate unitless counts.
- **A4 edges (review round 1):** `12-15` and `1.2.3` stay SINGLE rejected tokens (no false `-15`/`1.2`); a leading `-` glued to a letter/digit (`MMP-9` → `mmp-9` → `-9`) is rejected by the preceding-char `[a-z0-9]` guard (`normalize` maps dashes to `-`). Only a *spaced* `12 -15` could still read `-15` as a negative — a rare v1 edge, left as-is.
- **Threshold:** `MIN_QUOTE_CHARS = 8` is a tunable floor that kills 1–3 char quotes while passing real bibliographic quotes (existing tests use long quotes).
- **Open question for Codex review:** is the A1 honesty badge (`verified · number/quote` + scope note) the right resolution for the "verified displays unvalidated prose" finding, or should the validator additionally downgrade `key_number`/`citation_card` whose `claim_text`/`title` contains assertions beyond the validated datum (stricter, but risks over-downgrading)? Recommendation: ship the honest badge now; treat stricter claim-grounding as a separate, evidence-gated change.
