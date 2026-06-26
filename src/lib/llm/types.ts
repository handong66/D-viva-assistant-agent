import type { z } from "zod";

export type LlmRole = "fast" | "default" | "hard";

export interface GenerateObjectArgs<T> {
  role: LlmRole;
  /** Stable label for logging, e.g. "judge", "prep_pack:digest". */
  purpose: string;
  schema: z.ZodType<T>;
  prompt: string;
  system?: string;
  thesisId?: string;
}

export interface GenerateTextArgs {
  role: LlmRole;
  purpose: string;
  prompt: string;
  system?: string;
  thesisId?: string;
}

export interface LlmClient {
  readonly enabled: boolean;
  generateObject<T>(args: GenerateObjectArgs<T>): Promise<T>;
  generateText(args: GenerateTextArgs): Promise<string>;
}

/** The single seam that touches a model provider. Implemented by aiSdkTransport(). */
export interface LlmTransport {
  object(model: string, schema: z.ZodType<unknown>, prompt: string, system?: string): Promise<unknown>;
  text(model: string, prompt: string, system?: string): Promise<string>;
}

export class LlmDisabledError extends Error {
  constructor(message = "AI is disabled (no provider key, or VIVA_AI_ENABLED=false)") {
    super(message);
    this.name = "LlmDisabledError";
  }
}
