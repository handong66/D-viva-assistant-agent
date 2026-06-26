import { describe, it, expect } from "vitest";
import { resolveModel, MissingModelEnvError } from "./model-registry";

describe("resolveModel", () => {
  it("returns the env value for the role", () => {
    expect(resolveModel("hard", { VIVA_MODEL_HARD: "openai/gpt-x" })).toBe("openai/gpt-x");
    expect(resolveModel("default", { VIVA_MODEL_DEFAULT: "anthropic/claude-sonnet-4.6" })).toBe(
      "anthropic/claude-sonnet-4.6",
    );
  });

  it("throws a clear error when the role's model env is unset", () => {
    expect(() => resolveModel("fast", {})).toThrow(MissingModelEnvError);
    expect(() => resolveModel("fast", {})).toThrow(/VIVA_MODEL_FAST/);
  });
});
