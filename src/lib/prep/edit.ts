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
