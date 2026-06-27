import type { SttOpts, SttResult, SttTransport } from "./types";

export class MockSttTransport implements SttTransport {
  readonly enabled = true;
  public readonly calls: { audio: Buffer; opts: SttOpts }[] = [];

  constructor(private readonly transcript: string) {}

  async transcribe(audio: Buffer, opts: SttOpts): Promise<SttResult> {
    this.calls.push({ audio, opts });
    return { transcript: this.transcript };
  }
}
