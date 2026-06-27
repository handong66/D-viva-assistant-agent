"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveThesis, getPrepItemForEdit } from "../../db/repository";
import { runPrepPackGeneration } from "../../lib/llm/prep-pack-run";
import { editAndRevalidatePrepItem } from "../../lib/prep/edit";
import { appContext, appLlmClient } from "../../lib/server/context";

export type GenerateState = { error: string | null; generated: number | null };

export async function generatePrepPackAction(
  _prev: GenerateState,
  _formData: FormData,
): Promise<GenerateState> {
  try {
    const { db, config } = await appContext();
    const thesis = getActiveThesis(db);

    if (!thesis) {
      return { error: "No active thesis found. Please import a thesis first.", generated: null };
    }

    if (!config.effectiveAiEnabled || !config.gatewayConfigured) {
      return {
        error: "AI is disabled. Set AI_GATEWAY_API_KEY and VIVA_AI_ENABLED=true to generate a prep pack.",
        generated: null,
      };
    }

    const client = await appLlmClient({ db, config });
    const res = await runPrepPackGeneration(db, client, thesis.id);
    revalidatePath("/materials");
    return { error: null, generated: res.itemCount };
  } catch (error) {
    console.error("[generatePrepPackAction]", error);
    return { error: "Generation failed. Please try again.", generated: null };
  }
}

export async function editPrepItemAction(formData: FormData): Promise<void> {
  const { db } = await appContext();
  const id = String(formData.get("prepItemId") ?? "");
  const thesis = getActiveThesis(db);
  const item = id ? getPrepItemForEdit(db, id) : undefined;
  if (thesis && item && item.thesisId === thesis.id) {
    const rawNum = String(formData.get("valueNumeric") ?? "").trim();
    const valueNumeric = rawNum === "" || !Number.isFinite(Number(rawNum)) ? null : Number(rawNum);
    const str = (k: string) => { const v = String(formData.get(k) ?? "").trim(); return v === "" ? null : v; };
    editAndRevalidatePrepItem(db, id, { claimText: str("claimText"), evidenceQuote: str("evidenceQuote"), valueNumeric, unit: str("unit") });
  }
  revalidatePath("/materials");
  redirect("/materials");
}
