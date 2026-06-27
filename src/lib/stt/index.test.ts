import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config";
import { getSttTransport } from "./index";
import { MockSttTransport } from "./mock";
import { SttDisabledError } from "./types";

const sttMocks = vi.hoisted(() => {
  const liveTransport = {
    enabled: true,
    transcribe: vi.fn(async () => ({ transcript: "live" })),
  };
  return {
    liveTransport,
    googleSttTransport: vi.fn(() => liveTransport),
  };
});

vi.mock("./google", () => ({
  googleSttTransport: sttMocks.googleSttTransport,
}));

const baseConfig: Config = {
  aiFlag: true,
  hasProviderKey: false,
  gatewayConfigured: false,
  effectiveAiEnabled: false,
  sttProvider: "off",
  sttConfigured: false,
  dbPath: ":memory:",
  runLiveAi: false,
};

describe("getSttTransport", () => {
  beforeEach(() => {
    sttMocks.googleSttTransport.mockClear();
    sttMocks.googleSttTransport.mockReturnValue(sttMocks.liveTransport);
  });

  it("honours an injected override", () => {
    const mock = new MockSttTransport("hello");
    expect(getSttTransport(baseConfig, mock)).toBe(mock);
  });

  it("returns googleSttTransport when google_cloud STT is configured", () => {
    const transport = getSttTransport({
      ...baseConfig,
      sttProvider: "google_cloud",
      sttConfigured: true,
    });

    expect(sttMocks.googleSttTransport).toHaveBeenCalledTimes(1);
    expect(transport).toBe(sttMocks.liveTransport);
  });

  it("returns a disabled SttDisabledError transport when STT is not configured", async () => {
    const transport = getSttTransport({
      ...baseConfig,
      sttProvider: "google_cloud",
      sttConfigured: false,
    });

    expect(transport.enabled).toBe(false);
    await expect(
      transport.transcribe(Buffer.alloc(0), { mime: "audio/webm", languageMode: "english" }),
    ).rejects.toBeInstanceOf(SttDisabledError);
  });
});
