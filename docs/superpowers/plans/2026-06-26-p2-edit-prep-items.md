# Polish P2 — Edit a prep item → re-validate

> **老流程:** Codex implements per task; Claude runs the gate + reviews + commits, with a Codex design review before code and a milestone gate after. (Polish item — exercises the P0-2 validator, so it gets a milestone gate.)

**Goal:** Let the user correct a generated prep item (a wrong number, a better supporting quote, a clearer claim) and have the **validator re-run on the bound evidence**, so the item's status (`verified`/`needs_review`/`unsafe`) updates. An edited item is re-grounded against evidence — never trusted just because a human typed it.

**Architecture:** A service `editAndRevalidatePrepItem(db, id, edits)` that, in ONE transaction, writes **type-scoped** edits (marking `source='edited'`) then re-runs the **existing** `validatePrepItem` over the item's **existing bound evidence** and persists via the **existing** `applyValidation`. No new validator logic, no AI, no re-binding. A dedicated edit page + a Server Action drive it; the materials list gets an "Edit" link.

> **The red-line crux (rounds 1-2).** `validatePrepItem` certifies a *different field per type*, and a field it doesn't certify must not be human-editable into a `verified` item (materials shows `claimText`/`title` under the badge). From validator.ts:
> - **key_number** (79-83) → certifies the NUMBER only (`value_numeric`/`unit` ∈ evidence); **ignores `claim_text` and `evidence_quote`**.
> - **citation_card** (87-91) → certifies the QUOTE only (`evidence_quote` ∈ evidence); **ignores `claim_text`**.
> - **prose types** — digest/qa/hostile/theory_card (93-103) → `verified` requires `claim_text` to be *verbatim the matched evidence quote*; a paraphrase → `needs_review`, no quote → `needs_review`.
>
> So `claim_text` is only safe to edit for the **prose** types (the validator there refuses to mark a free paraphrase `verified`). For `key_number` and `citation_card` the validator ignores `claim_text`, so letting a human edit it would display unvalidated text under `verified` — **red line #1**. **Fix:** a single source of truth `editableFields(type)` — `claim` editable only for prose types; `quote` editable for everything except key_number; `num` editable only for key_number. The service scopes edits through it (the *guarantee*, immune to a forged POST) and the form mirrors it (UX). Every field an edit can change is then governed by the validator. (Relabeling a key_number/citation_card's prose is deferred.)

**Tech Stack:** better-sqlite3 (transaction), the existing `src/lib/evidence/validator.ts`, Next 16 RSC + async `params` + a server-component `<form action={...}>`, Tailwind, vitest.

> **Scope:** edit the validator-relevant fields, type-scoped via `editableFields`. NOT in scope: changing item type, re-binding which evidence supports an item (binding is fixed at generation), relabeling a key_number/citation_card's prose, deleting items.

---

## Contracts

```ts
// src/db/repository.ts
export type PrepItemForEdit = { id: string; thesisId: string; type: PrepItemType; title: string; claimText: string | null; evidenceQuote: string | null; valueNumeric: number | null; unit: string | null; status: string };
export function getPrepItemForEdit(db: DB, prepItemId: string): PrepItemForEdit | undefined;
export function updatePrepItemFields(db: DB, prepItemId: string, edits: PrepItemEdits): void; // sets source='edited'

// src/lib/prep/edit.ts
export type PrepItemEdits = { claimText: string | null; evidenceQuote: string | null; valueNumeric: number | null; unit: string | null };
export function editableFields(type: PrepItemType): { claim: boolean; quote: boolean; num: boolean }; // the single source of truth
export function editAndRevalidatePrepItem(db: DB, prepItemId: string, edits: PrepItemEdits): Verdict; // scopes via editableFields; throws if missing

// src/app/_actions/prep.ts (existing file) — add
export async function editPrepItemAction(formData: FormData): Promise<void>;
```

## File structure

- **Modify** `src/db/repository.ts` — `getPrepItemForEdit`, `updatePrepItemFields`, `PrepItemForEdit` (add `type PrepItemType` to the line-4 validator import).
- **Create** `src/lib/prep/edit.ts` (+`src/lib/prep/edit.test.ts`) — `editableFields`, `editAndRevalidatePrepItem`, `PrepItemEdits`.
- **Modify** `src/app/_actions/prep.ts` — `editPrepItemAction`.
- **Create** `src/app/materials/[id]/edit/page.tsx` — the `editableFields`-driven form + a read-only bound-evidence panel.
- **Modify** `src/app/materials/page.tsx` — an "Edit" link per item.

---

### Task 1: repository helpers + `editableFields` + the type-scoping service

**Files:** Modify `src/db/repository.ts`, Create `src/lib/prep/edit.ts` + `src/lib/prep/edit.test.ts`

- [ ] **Step 1: Write the failing test** — covers `editableFields` and the service across all three type families, incl. the red-line guarantee that an ignored field's edit is dropped:

```ts
// src/lib/prep/edit.test.ts
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
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3a: Implement the repository helpers** — append to `src/db/repository.ts`, and add `type PrepItemType` to the existing validator import on line 4 → `import { VALIDATOR_VERSION, type EvidenceText, type Verdict, type PrepItemType } from "../lib/evidence/validator";`:

```ts
export type PrepItemForEdit = { id: string; thesisId: string; type: PrepItemType; title: string; claimText: string | null; evidenceQuote: string | null; valueNumeric: number | null; unit: string | null; status: string };

export function getPrepItemForEdit(db: DB, prepItemId: string): PrepItemForEdit | undefined {
  const r = db
    .prepare("SELECT id, thesis_id, type, title, claim_text, evidence_quote, value_numeric, unit, status FROM prep_item WHERE id = ?")
    .get(prepItemId) as { id: string; thesis_id: string; type: PrepItemType; title: string; claim_text: string | null; evidence_quote: string | null; value_numeric: number | null; unit: string | null; status: string } | undefined;
  return r && { id: r.id, thesisId: r.thesis_id, type: r.type, title: r.title, claimText: r.claim_text, evidenceQuote: r.evidence_quote, valueNumeric: r.value_numeric, unit: r.unit, status: r.status };
}

export function updatePrepItemFields(db: DB, prepItemId: string, edits: { claimText: string | null; evidenceQuote: string | null; valueNumeric: number | null; unit: string | null }): void {
  db.prepare(
    `UPDATE prep_item SET claim_text=@claim_text, evidence_quote=@evidence_quote, value_numeric=@value_numeric, unit=@unit, source='edited', updated_at=datetime('now') WHERE id=@id`,
  ).run({ id: prepItemId, claim_text: edits.claimText, evidence_quote: edits.evidenceQuote, value_numeric: edits.valueNumeric, unit: edits.unit });
}
```

- [ ] **Step 3b: Implement `editableFields` + the service** — `src/lib/prep/edit.ts`:

```ts
import type { Database as DB } from "better-sqlite3";
import { getPrepItemForEdit, updatePrepItemFields, getBoundEvidence, applyValidation } from "../../db/repository";
import { validatePrepItem, type Verdict, type PrepItemType } from "../evidence/validator";

export type PrepItemEdits = { claimText: string | null; evidenceQuote: string | null; valueNumeric: number | null; unit: string | null };

/** Which fields an edit may change, by what validatePrepItem certifies for the `verified` verdict (red line #1):
 *  - key_number  → certifies the NUMBER; claim_text & evidence_quote are ignored → preserve them.
 *  - citation_card → certifies the QUOTE; claim_text is ignored → preserve it.
 *  - prose types → `verified` needs claim===matched-quote, so a free claim can't earn trust → claim/quote editable. */
export function editableFields(type: PrepItemType): { claim: boolean; quote: boolean; num: boolean } {
  return {
    claim: type !== "key_number" && type !== "citation_card",
    quote: type !== "key_number",
    num: type === "key_number",
  };
}

/** Persist an edit and immediately re-validate against the (unchanged) bound evidence — atomically.
 *  Scopes edits via editableFields so a field the validator ignores can never carry human text into a verified item.
 *  Enforced here (not the form), so a forged POST can't bypass it. Throws if the item is gone. */
export function editAndRevalidatePrepItem(db: DB, prepItemId: string, edits: PrepItemEdits): Verdict {
  const item = getPrepItemForEdit(db, prepItemId);
  if (!item) throw new Error(`prep item not found: ${prepItemId}`);
  const f = editableFields(item.type);
  const scoped: PrepItemEdits = {
    claimText: f.claim ? edits.claimText : item.claimText,
    evidenceQuote: f.quote ? edits.evidenceQuote : item.evidenceQuote,
    valueNumeric: f.num ? edits.valueNumeric : item.valueNumeric,
    unit: f.num ? edits.unit : item.unit,
  };
  let verdict!: Verdict;
  db.transaction(() => {
    updatePrepItemFields(db, prepItemId, scoped);
    const bound = getBoundEvidence(db, prepItemId);
    verdict = validatePrepItem({ type: item.type, claim_text: scoped.claimText, evidence_quote: scoped.evidenceQuote, value_numeric: scoped.valueNumeric, unit: scoped.unit }, bound);
    applyValidation(db, prepItemId, verdict);
  })();
  return verdict;
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (6).
- [ ] **Step 5: Commit** — `git commit -m "feat(p2): editableFields + type-scoped edit+revalidate service + repository helpers"`

---

### Task 2: `editPrepItemAction` + edit page + materials "Edit" link

**Files:** Modify `src/app/_actions/prep.ts`, Create `src/app/materials/[id]/edit/page.tsx`, Modify `src/app/materials/page.tsx`

- [ ] **Step 1: Add the action** — append to `src/app/_actions/prep.ts` (mirror `generatePrepPackAction`'s `await appContext()` + `getActiveThesis` + revalidate/redirect). The action passes all four fields; the service scopes via `editableFields`, so a forged claim on a key_number/citation_card is ignored:

```ts
// add imports: getActiveThesis, getPrepItemForEdit from ../../db/repository; editAndRevalidatePrepItem from ../../lib/prep/edit
export async function editPrepItemAction(formData: FormData): Promise<void> {
  const { db } = await appContext();
  const id = String(formData.get("prepItemId") ?? "");
  const thesis = getActiveThesis(db);
  const item = id ? getPrepItemForEdit(db, id) : undefined;
  if (thesis && item && item.thesisId === thesis.id) {       // same-thesis guard — never edit another thesis's item
    const rawNum = String(formData.get("valueNumeric") ?? "").trim();
    const valueNumeric = rawNum === "" || !Number.isFinite(Number(rawNum)) ? null : Number(rawNum);
    const str = (k: string) => { const v = String(formData.get(k) ?? "").trim(); return v === "" ? null : v; };
    editAndRevalidatePrepItem(db, id, { claimText: str("claimText"), evidenceQuote: str("evidenceQuote"), valueNumeric, unit: str("unit") });
  }
  revalidatePath("/materials");
  redirect("/materials");                                     // OUTSIDE any try — control-flow signal
}
```

- [ ] **Step 2: Implement the edit page** — `src/app/materials/[id]/edit/page.tsx` (Next 16: `params` is a Promise). The form is driven by the SAME `editableFields`, and a read-only bound-evidence panel shows what a valid number/quote must match:

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { appContext } from "../../../../lib/server/context";
import { getActiveThesis, getPrepItemForEdit, getBoundEvidence } from "../../../../db/repository";
import { editableFields } from "../../../../lib/prep/edit";
import { editPrepItemAction } from "../../../_actions/prep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditPrepItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await appContext();
  const thesis = getActiveThesis(db);
  if (!thesis) redirect("/import");
  const item = getPrepItemForEdit(db, id);
  if (!item || item.thesisId !== thesis.id) notFound();
  const bound = getBoundEvidence(db, id);
  const f = editableFields(item.type);

  const input = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Edit prep item</h1>
        <p className="text-sm text-zinc-500">{item.type.replaceAll("_", " ")} · re-validated against its bound evidence on save.</p>
      </div>

      <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <p className="font-medium">Bound evidence</p>
        {bound.length === 0 ? (
          <p className="mt-1 text-zinc-500">No evidence bound — this item can’t be verified.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1 text-zinc-600 dark:text-zinc-400">{bound.map((e) => <li key={e.id}>“{e.text}”</li>)}</ul>
        )}
      </div>

      <form action={editPrepItemAction} className="flex flex-col gap-4">
        <input type="hidden" name="prepItemId" value={item.id} />
        {f.claim ? (
          <label className="flex flex-col gap-1 text-sm font-medium">Claim
            <textarea name="claimText" rows={3} defaultValue={item.claimText ?? ""} className={input} />
          </label>
        ) : (
          <p className="text-sm text-zinc-500">Claim (fixed): <span className="text-zinc-700 dark:text-zinc-300">{item.claimText ?? item.title}</span></p>
        )}
        {f.quote ? (
          <label className="flex flex-col gap-1 text-sm font-medium">Supporting quote (must appear verbatim in the bound evidence above)
            <textarea name="evidenceQuote" rows={3} defaultValue={item.evidenceQuote ?? ""} className={input} />
          </label>
        ) : null}
        {f.num ? (
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium">Value
              <input name="valueNumeric" type="number" step="any" defaultValue={item.valueNumeric ?? ""} className={input} />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium">Unit
              <input name="unit" type="text" defaultValue={item.unit ?? ""} className={input} />
            </label>
          </div>
        ) : null}
        <div className="flex gap-3">
          <button type="submit" className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">Save &amp; re-validate</button>
          <Link href="/materials" className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700">Cancel</Link>
        </div>
      </form>
    </section>
  );
}
```

> The form and the service share `editableFields`, so they can't drift. A fixed field is shown read-only (or omitted); even a forged POST is dropped by the service. The same-thesis check is in BOTH the page (`notFound`) and the action.

- [ ] **Step 3: Add the "Edit" link** — in `src/app/materials/page.tsx`'s `PrepItem`, add a `<Link href={\`/materials/${item.id}/edit\`}>Edit</Link>` (small, right-aligned by the status badge; `<Link>` not `<a>`; match the existing card styling). `getPrepItems` already returns `item.id`.

- [ ] **Step 4: Typecheck + build** — `npx tsc --noEmit` (exit 0). (Claude runs `npm run build`.)
- [ ] **Step 5: Commit** — `git commit -m "feat(p2): edit prep-item page + action + materials edit link"`

---

## Gate + smoke (Claude)

```bash
npm run check   # + the 6 edit/revalidate tests
npm run build   # /materials/[id]/edit Dynamic
```
Dev smoke (AI off): seed a verified key_number → `/materials` shows it `verified` w/ Edit → edit page shows bound evidence + value/unit (claim read-only) → wrong number → Save → `unsafe`; back to right → `verified`. Seed a citation_card → edit page shows quote editable, claim read-only → off-evidence quote → `unsafe`.

## Red lines

1. **Evidence-binding preserved — edits never grant trust (red line #1):** `editableFields` makes a field editable only where `validatePrepItem` certifies it for the `verified` verdict; every other field is preserved-as-generated. So no edit can put unvalidated human text under a `verified` badge — key_number/citation_card claim text is fixed; prose claims that aren't a verbatim matched quote stay `needs_review`. Enforced in the service (forged-POST-proof). `applyValidation` still downgrades `passed`→`needs_review` with no binding.
2. **No AI, local-first:** re-validation is the deterministic validator only — no model call; nothing leaves the machine. `source='edited'` records provenance.
3. **Atomic:** field write + re-validation run in one `db.transaction`.
4. **Same-thesis guard:** page (`notFound`) + action both refuse an id that isn't the active thesis's item.

## Self-review

- **Reuse, not reinvention:** `validatePrepItem` + `applyValidation` + `getBoundEvidence` unchanged; P2 only scopes which fields an edit may touch, via the single `editableFields` source of truth shared by service + form.
- **Rounds 1-2 NO-GO resolved:** key_number (round 1) AND citation_card (round 2) — both are types whose validator ignores `claim_text`; `editableFields` makes `claim` non-editable for exactly those two, with tests asserting a forged claim is dropped for each, plus a prose test showing claim IS editable but can't reach `verified` ungrounded. Bound-evidence panel included.
- **Type consistency:** `PrepItemEdits` ⊂ `PrepItemInput`; `editAndRevalidatePrepItem` returns the `Verdict`; `editableFields(type: PrepItemType)`.
- **Testable surface:** Task 1 (editableFields + the scoped edit→revalidate→persist path across key_number/citation_card/prose) is unit-tested over the real validator; Task 2 (page/action) is typecheck + build + dev smoke. The action's same-thesis guard is read-reviewed + smoked (not unit-tested — it wraps appContext/redirect).
- **Open question for round-3 review:** is `editableFields`-driven scoping the right boundary (vs hardening the validator to also check claim grounding for key_number/citation_card)? Scoping keeps the validator untouched and makes every editable field validator-governed; the cost is that a key_number/citation_card prose label can't be corrected via this flow (deferred). Acceptable for v1?
