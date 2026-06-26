import type { LlmRole } from "./types";

const ENV_KEY: Record<LlmRole, string> = {
  fast: "VIVA_MODEL_FAST",
  default: "VIVA_MODEL_DEFAULT",
  hard: "VIVA_MODEL_HARD",
};

export class MissingModelEnvError extends Error {
  constructor(envKey: string) {
    super(`Model env ${envKey} is not set. Set it (see .env.example) or disable AI.`);
    this.name = "MissingModelEnvError";
  }
}

/** Resolve a role to an AI Gateway "provider/model" string from env. No hardcoded defaults. */
export function resolveModel(
  role: LlmRole,
  env: Record<string, string | undefined> = process.env,
): string {
  const key = ENV_KEY[role];
  const value = env[key];
  if (!value) throw new MissingModelEnvError(key);
  return value;
}
