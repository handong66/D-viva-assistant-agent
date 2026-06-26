import "server-only";
import type { Database as DB } from "better-sqlite3";
import type { LlmClient } from "./types";
import { generatePrepPack } from "./prep-pack";
import {
  createGenerationRun, finalizeGenerationRun, getThesisEvidence,
  insertGeneratedPrepItem, bindPrepEvidence, getBoundEvidence, applyValidation,
  EvidenceBindingError,
} from "../../db/repository";
import { validatePrepItem, type PrepItemType } from "../evidence/validator";

export async function runPrepPackGeneration(
  db: DB, client: LlmClient, thesisId: string,
): Promise<{ runId: string; runStatus: "done" | "error"; itemCount: number }> {
  const runId = createGenerationRun(db, thesisId, "prep_pack");
  try {
    const evidence = getThesisEvidence(db, thesisId);
    const thesis = db.prepare("SELECT title FROM thesis WHERE id=?").get(thesisId) as { title: string };
    const items = await generatePrepPack(client, { thesisId, title: thesis.title, evidence });
    for (const item of items) {
      const prepId = insertGeneratedPrepItem(db, {
        thesisId, generationRunId: runId, type: item.type, title: item.title,
        claim_text: item.claim_text, evidence_quote: item.evidence_quote,
        value_numeric: item.value_numeric, unit: item.unit,
      });
      // Narrow catch: ONLY bindPrepEvidence may fail expectedly (bad/cross-thesis
      // citation). Validator/DB errors propagate to the outer catch.
      let bound = true;
      const evidenceUnitIds = Array.from(new Set(item.evidence_unit_ids));
      try {
        bindPrepEvidence(db, prepId, evidenceUnitIds);
      } catch (bindErr) {
        if (!(bindErr instanceof EvidenceBindingError)) {
          throw bindErr;
        }
        applyValidation(db, prepId, { validationStatus: "failed", supportKind: "existence", reason: bindErr instanceof Error ? bindErr.message : "bind failed" });
        bound = false;
      }
      if (bound) {
        const verdict = validatePrepItem(
          { type: item.type as PrepItemType, claim_text: item.claim_text, evidence_quote: item.evidence_quote, value_numeric: item.value_numeric, unit: item.unit },
          getBoundEvidence(db, prepId),
        );
        applyValidation(db, prepId, verdict);
      }
    }
    finalizeGenerationRun(db, runId, "done");
    return { runId, runStatus: "done", itemCount: items.length };
  } catch (err) {
    finalizeGenerationRun(db, runId, "error", err instanceof Error ? err.message : String(err));
    throw err;
  }
}
