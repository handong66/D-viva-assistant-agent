"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveThesis, savePlan } from "../../db/repository";
import { runTrainingPlanGeneration } from "../../lib/llm/training-plan-run";
import { clampPlanDays, staticPlanDays } from "../../lib/plan";
import { appContext, appLlmClient } from "../../lib/server/context";

export async function generatePlanAction(formData: FormData): Promise<void> {
  const { db, config } = await appContext();
  const thesis = getActiveThesis(db);
  if (!thesis) redirect("/import");

  const totalDays = clampPlanDays(Number(formData.get("days")));
  const saveStatic = () => {
    savePlan(db, {
      thesisId: thesis.id,
      name: `${totalDays}-day plan`,
      totalDays,
      templateKey: "static",
      days: staticPlanDays(totalDays),
    });
  };

  if (config.effectiveAiEnabled && config.gatewayConfigured) {
    try {
      const llmClient = await appLlmClient({ db, config });
      await runTrainingPlanGeneration({ db, llmClient, totalDays, thesisId: thesis.id });
    } catch (error) {
      console.error("[generatePlanAction]", error);
      saveStatic();
    }
  } else {
    saveStatic();
  }

  revalidatePath("/plan");
  revalidatePath("/");
  redirect("/plan");
}
