import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("effectiveAiEnabled is false when flag true but no provider key", () => {
    const c = loadConfig({ VIVA_AI_ENABLED: "true" });
    expect(c.effectiveAiEnabled).toBe(false);
  });

  it("gatewayConfigured reflects whether AI_GATEWAY_API_KEY is set", () => {
    expect(loadConfig({ AI_GATEWAY_API_KEY: "gw-x" }).gatewayConfigured).toBe(true);
    expect(loadConfig({}).gatewayConfigured).toBe(false);
  });

  it("effectiveAiEnabled is true when flag true and a provider key resolves", () => {
    const c = loadConfig({ VIVA_AI_ENABLED: "true", ANTHROPIC_API_KEY: "sk-x" });
    expect(c.effectiveAiEnabled).toBe(true);
  });

  it("effectiveAiEnabled is false when flag false even with a key", () => {
    const c = loadConfig({ VIVA_AI_ENABLED: "false", OPENAI_API_KEY: "sk-x" });
    expect(c.effectiveAiEnabled).toBe(false);
  });

  it("defaults sttProvider to off and dbPath to ./data/d-viva-assistant-agent.sqlite", () => {
    const c = loadConfig({});
    expect(c.sttProvider).toBe("off");
    expect(c.dbPath).toBe("./data/d-viva-assistant-agent.sqlite");
  });

  it("does NOT enable AI when only GOOGLE_VERTEX_PROJECT is set (project id is not a credential)", () => {
    const c = loadConfig({ VIVA_AI_ENABLED: "true", GOOGLE_VERTEX_PROJECT: "my-proj" });
    expect(c.effectiveAiEnabled).toBe(false);
  });

  it("enables AI when Vertex ADC credentials (GOOGLE_APPLICATION_CREDENTIALS) are present", () => {
    const c = loadConfig({ VIVA_AI_ENABLED: "true", GOOGLE_APPLICATION_CREDENTIALS: "/path/sa.json" });
    expect(c.effectiveAiEnabled).toBe(true);
  });

  it("sttConfigured requires google_cloud provider AND a key", () => {
    expect(loadConfig({ STT_PROVIDER: "google_cloud", GOOGLE_STT_API_KEY: "k" }).sttConfigured).toBe(true);
    expect(loadConfig({ STT_PROVIDER: "google_cloud" }).sttConfigured).toBe(false);
    expect(loadConfig({ STT_PROVIDER: "browser", GOOGLE_STT_API_KEY: "k" }).sttConfigured).toBe(false);
    expect(loadConfig({}).sttConfigured).toBe(false);
  });
});
