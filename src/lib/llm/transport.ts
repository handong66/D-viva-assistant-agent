import "server-only";
import { generateText, Output } from "ai";
import type { z } from "zod";
import type { LlmTransport } from "./types";

export function aiSdkTransport(): LlmTransport {
  return {
    async object(model, schema, prompt, system, signal) {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: schema as z.ZodType<unknown> }),
        prompt,
        instructions: system,
        abortSignal: signal,
      });
      return output;
    },
    async text(model, prompt, system, signal) {
      const { text } = await generateText({
        model,
        prompt,
        instructions: system,
        abortSignal: signal,
      });
      return text;
    },
  };
}
