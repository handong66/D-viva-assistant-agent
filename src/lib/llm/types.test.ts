import { describe, it, expect } from "vitest";
import { LlmDisabledError } from "./types";

describe("LlmDisabledError", () => {
  it("is an Error with a clear name", () => {
    const e = new LlmDisabledError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("LlmDisabledError");
  });
});
