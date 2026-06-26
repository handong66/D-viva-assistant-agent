import { z } from "zod";

const EnvSchema = z.object({
  VIVA_AI_ENABLED: z.enum(["true", "false"]).default("true"),
  AI_GATEWAY_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_VERTEX_PROJECT: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  STT_PROVIDER: z.enum(["off", "browser", "google_cloud"]).default("off"),
  VIVA_DB_PATH: z.string().default("./data/viva.sqlite"),
  RUN_LIVE_AI: z.string().optional(),
});

export type Config = {
  aiFlag: boolean;
  hasProviderKey: boolean;
  gatewayConfigured: boolean;
  effectiveAiEnabled: boolean;
  sttProvider: "off" | "browser" | "google_cloud";
  dbPath: string;
  runLiveAi: boolean;
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.parse(env);
  const aiFlag = parsed.VIVA_AI_ENABLED === "true";
  const hasProviderKey = Boolean(
    parsed.AI_GATEWAY_API_KEY ||
      parsed.GOOGLE_GENERATIVE_AI_API_KEY ||
      parsed.ANTHROPIC_API_KEY ||
      parsed.OPENAI_API_KEY ||
      // Vertex needs real credentials (ADC), not just a project id.
      parsed.GOOGLE_APPLICATION_CREDENTIALS,
  );
  return {
    aiFlag,
    hasProviderKey,
    gatewayConfigured: Boolean(parsed.AI_GATEWAY_API_KEY),
    effectiveAiEnabled: aiFlag && hasProviderKey,
    sttProvider: parsed.STT_PROVIDER,
    dbPath: parsed.VIVA_DB_PATH,
    runLiveAi: parsed.RUN_LIVE_AI === "1",
  };
}

let cached: Config | null = null;
export function getConfig(): Config {
  if (!cached) cached = loadConfig(process.env);
  return cached;
}

/** Test-only: clear the cached config so a later getConfig() re-reads process.env. */
export function _resetConfigCache(): void {
  cached = null;
}
