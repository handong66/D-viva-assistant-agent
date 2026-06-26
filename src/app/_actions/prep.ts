"use server";

import { revalidatePath } from "next/cache";
import { getActiveThesis } from "../../db/repository";
import { runPrepPackGeneration } from "../../lib/llm/prep-pack-run";
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
