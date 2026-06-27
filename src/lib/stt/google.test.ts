import { afterEach, describe, expect, it, vi } from "vitest";
import { googleSttTransport, opusEncoding } from "./google";

const savedGoogleSttApiKey = process.env.GOOGLE_STT_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedGoogleSttApiKey === undefined) delete process.env.GOOGLE_STT_API_KEY;
  else process.env.GOOGLE_STT_API_KEY = savedGoogleSttApiKey;
});

describe("googleSttTransport", () => {
  it("posts base64 audio with WEBM_OPUS config and returns the joined transcript", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          results: [
            { alternatives: [{ transcript: "hello" }] },
            { alternatives: [{ transcript: "world" }] },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    process.env.GOOGLE_STT_API_KEY = "test-key";

    const result = await googleSttTransport().transcribe(Buffer.from([1, 2, 3]), {
      mime: "audio/webm",
      languageMode: "english",
    });

    expect(result.transcript).toBe("hello world");
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    expect(String(url)).toContain("speech.googleapis.com");
    expect(String(url)).toContain("key=test-key");
    if (!init) throw new Error("fetch init missing");
    const body = JSON.parse(String(init.body)) as {
      config: { languageCode: string; encoding: string; sampleRateHertz: number };
      audio: { content: string };
    };
    expect(body.config).toMatchObject({
      encoding: "WEBM_OPUS",
      sampleRateHertz: 48000,
      languageCode: "en-US",
    });
    expect(body.audio.content).toBe(Buffer.from([1, 2, 3]).toString("base64"));
  });

  it("maps MediaRecorder's codecs-suffixed mime to an opus encoding", () => {
    expect(opusEncoding("audio/webm;codecs=opus")).toBe("WEBM_OPUS");
    expect(opusEncoding("audio/ogg;codecs=opus")).toBe("OGG_OPUS");
    expect(opusEncoding("audio/wav")).toBeNull();
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));
    process.env.GOOGLE_STT_API_KEY = "k";

    await expect(
      googleSttTransport().transcribe(Buffer.from([1]), {
        mime: "audio/webm",
        languageMode: "chinese",
      }),
    ).rejects.toThrow(/400/);
  });
});
