import { describe, it, expect } from "vitest";
import { sttUiMode } from "./mode";

describe("sttUiMode", () => {
  it("google_cloud only when configured, else off (no key → can't record)", () => {
    expect(sttUiMode({ sttProvider: "google_cloud", sttConfigured: true })).toBe("google_cloud");
    expect(sttUiMode({ sttProvider: "google_cloud", sttConfigured: false })).toBe("off");
  });
  it("browser needs no key; off stays off", () => {
    expect(sttUiMode({ sttProvider: "browser", sttConfigured: false })).toBe("browser");
    expect(sttUiMode({ sttProvider: "off", sttConfigured: false })).toBe("off");
  });
});
