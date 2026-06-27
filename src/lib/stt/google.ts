import "server-only";
import { SttTooLongError, type SttOpts, type SttResult, type SttTransport } from "./types";

export function opusEncoding(mime: string): string | null {
  // MediaRecorder emits e.g. "audio/webm;codecs=opus" — match the container substring.
  if (mime.includes("webm")) return "WEBM_OPUS";
  if (mime.includes("ogg")) return "OGG_OPUS";
  return null;
}

export function googleSttTransport(): SttTransport {
  return {
    enabled: true,
    async transcribe(audio: Buffer, opts: SttOpts): Promise<SttResult> {
      const key = process.env.GOOGLE_STT_API_KEY;
      if (!key) throw new Error("GOOGLE_STT_API_KEY not set"); // fail closed: no audio leaves without a key
      const languageCode = opts.languageMode === "english" ? "en-US" : "cmn-Hans-CN";
      const config: { languageCode: string; encoding?: string; sampleRateHertz?: number } = {
        languageCode,
      };
      const encoding = opusEncoding(opts.mime);
      if (encoding) {
        config.encoding = encoding;
        config.sampleRateHertz = 48000;
      }

      const response = await fetch(
        `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            config,
            audio: { content: audio.toString("base64") },
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        // Narrow to Google's strong sync-length markers; weaker "longer than"/"use a uri" phrases
        // could appear in unrelated 400s (bad key/encoding), which must stay generic errors.
        if (response.status === 400 && /too long|longrunningrecognize/i.test(detail)) {
          throw new SttTooLongError();
        }
        throw new Error(`Google STT request failed with status ${response.status}`);
      }

      const body = (await response.json()) as {
        results?: { alternatives?: { transcript?: string }[] }[];
      };
      const transcript = (body.results ?? [])
        .map((result) => result.alternatives?.[0]?.transcript ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return { transcript };
    },
  };
}
