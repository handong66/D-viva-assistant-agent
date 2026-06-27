export type SttResult = { transcript: string };

export type SttOpts = { mime: string; languageMode: "english" | "chinese" };

export interface SttTransport {
  readonly enabled: boolean;
  transcribe(audio: Buffer, opts: SttOpts): Promise<SttResult>;
}

export class SttDisabledError extends Error {
  constructor(message = "STT is not configured") {
    super(message);
    this.name = "SttDisabledError";
  }
}

export class SttTooLongError extends Error {
  constructor() {
    super("This recording is over Google Cloud's ~1-minute limit. Keep your answer under a minute, or set STT_PROVIDER=browser, which uses your browser's continuous speech recognition (no app key, and not subject to this ~1-minute limit).");
    this.name = "SttTooLongError";
  }
}
