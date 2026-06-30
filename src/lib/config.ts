import { z } from "zod";
import { normalizeUiLocale, type UiLocale } from "./ui-copy";

const EnvSchema = z.object({
  VIVA_AI_ENABLED: z.enum(["true", "false"]).default("false"),
  AI_GATEWAY_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_VERTEX_PROJECT: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  STT_PROVIDER: z.enum(["off", "browser", "google_cloud"]).default("off"),
  GOOGLE_STT_API_KEY: z.string().optional(),
  VIVA_DB_PATH: z.string().default("./data/d-viva-assistant-agent.sqlite"),
  RUN_LIVE_AI: z.string().optional(),
  DVA_UI_LOCALE: z.enum(["en", "zh-CN"]).default("en"),
});

export type Config = {
  aiFlag: boolean;
  hasProviderKey: boolean;
  gatewayConfigured: boolean;
  effectiveAiEnabled: boolean;
  sttProvider: "off" | "browser" | "google_cloud";
  sttConfigured: boolean;
  dbPath: string;
  runLiveAi: boolean;
  uiLocale: UiLocale;
};

// Pure: every field derives from the injected `env` (getConfig passes process.env).
// Kept pure for testability — do not read process.env directly here.
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
    sttConfigured: parsed.STT_PROVIDER === "google_cloud" && Boolean(parsed.GOOGLE_STT_API_KEY),
    dbPath: parsed.VIVA_DB_PATH,
    runLiveAi: parsed.RUN_LIVE_AI === "1",
    uiLocale: normalizeUiLocale(parsed.DVA_UI_LOCALE),
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
