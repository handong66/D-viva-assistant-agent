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
