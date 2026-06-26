import { z } from "zod";
import type { LlmClient } from "./types";

export const GeneratedItemSchema = z.object({
  type: z.enum(["digest", "key_number", "qa", "hostile", "theory_card", "citation_card"]),
  title: z.string().min(1),
  claim_text: z.string().min(1),
  evidence_quote: z.string().nullable().default(null),
  value_numeric: z.number().nullable().default(null),
  unit: z.string().nullable().default(null),
  evidence_unit_ids: z.array(z.string()).min(1),
});
export const PrepPackSchema = z.object({ items: z.array(GeneratedItemSchema) });
export type GeneratedItem = z.infer<typeof GeneratedItemSchema>;

export function buildPrepPackPrompt(args: { title: string; evidence: { id: string; text: string }[] }): string {
  const ev = args.evidence.map((e) => `[${e.id}] ${e.text}`).join("\n");
  return [
    `You are preparing a viva (thesis defence) prep pack for the thesis "${args.title}".`,
    `Generate prep items (digest, key_number, qa, hostile, theory_card, citation_card) STRICTLY grounded in the evidence below.`,
    `Every item MUST cite the exact evidence_unit_ids it is grounded in. For key_number set value_numeric (and unit). For citation_card and any item whose claim is a verbatim quote, set evidence_quote to the exact source text. Do NOT invent numbers or quotes — only use what appears in the evidence.`,
    ``,
    `EVIDENCE (id: text):`,
    ev,
  ].join("\n");
}

export async function generatePrepPack(
  client: LlmClient,
  args: { thesisId: string; title: string; evidence: { id: string; text: string }[] },
): Promise<GeneratedItem[]> {
  const out = await client.generateObject({
    role: "default",
    purpose: "prep_pack",
    schema: PrepPackSchema,
    prompt: buildPrepPackPrompt(args),
    thesisId: args.thesisId,
  });
  return out.items;
}
