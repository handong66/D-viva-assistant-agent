import "server-only";
import type { Database as DB } from "better-sqlite3";
import type { GenerateObjectArgs, GenerateTextArgs, LlmClient } from "./types";
import { LlmDisabledError } from "./types";
import { createLlmClient } from "./client";
import { resolveModel } from "./model-registry";
import { logAiCall } from "../../db/repository";

function disabledClient(): LlmClient {
  return {
    enabled: false,
    generateObject<T>(_args: GenerateObjectArgs<T>): Promise<T> {
      return Promise.reject(new LlmDisabledError());
    },
    generateText(_args: GenerateTextArgs): Promise<string> {
      return Promise.reject(new LlmDisabledError());
    },
  };
}

export async function getLlmClient(
  db: DB,
  opts: { effectiveAiEnabled: boolean; gatewayConfigured: boolean; override?: LlmClient },
): Promise<LlmClient> {
  if (opts.override) return opts.override;
  if (!opts.effectiveAiEnabled || !opts.gatewayConfigured) return disabledClient();

  const { aiSdkTransport } = await import("./transport");
  return createLlmClient(aiSdkTransport(), {
    resolveModel,
    logCall: (entry) => logAiCall(db, entry),
  });
}
