import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("effectiveAiEnabled is false when flag true but no provider key", () => {
    const c = loadConfig({ VIVA_AI_ENABLED: "true" });
    expect(c.effectiveAiEnabled).toBe(false);
  });

  it("effectiveAiEnabled is true when flag true and a provider key resolves", () => {
    const c = loadConfig({ VIVA_AI_ENABLED: "true", ANTHROPIC_API_KEY: "sk-x" });
    expect(c.effectiveAiEnabled).toBe(true);
  });

  it("effectiveAiEnabled is false when flag false even with a key", () => {
    const c = loadConfig({ VIVA_AI_ENABLED: "false", OPENAI_API_KEY: "sk-x" });
    expect(c.effectiveAiEnabled).toBe(false);
  });

  it("defaults sttProvider to off and dbPath to ./data/viva.sqlite", () => {
    const c = loadConfig({});
    expect(c.sttProvider).toBe("off");
    expect(c.dbPath).toBe("./data/viva.sqlite");
  });
});
