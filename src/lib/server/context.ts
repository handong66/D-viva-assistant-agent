import "server-only";

import type { Database as DB } from "better-sqlite3";
import { getDb } from "../../db/client";
import { loadConfig, type Config } from "../config";
import { getLlmClient } from "../llm";
import type { LlmClient } from "../llm/types";

export type AppContext = { config: Config; db: DB };

export async function appContext(): Promise<AppContext> {
  const config = loadConfig(process.env);
  const db = getDb(config.dbPath);
  return { config, db };
}

export function appLlmClient(ctx: AppContext): Promise<LlmClient> {
  return getLlmClient(ctx.db, {
    effectiveAiEnabled: ctx.config.effectiveAiEnabled,
    gatewayConfigured: ctx.config.gatewayConfigured,
  });
}
