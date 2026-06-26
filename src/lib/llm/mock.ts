import type { GenerateObjectArgs, GenerateTextArgs, LlmClient } from "./types";

type Call = { kind: "object" | "text"; role: string; purpose: string };

/** Deterministic LlmClient for tests. Script responses by purpose. */
export class MockLlmClient implements LlmClient {
  readonly enabled = true;
  readonly calls: Call[] = [];
  private objects = new Map<string, unknown>();
  private texts = new Map<string, string>();

  setObject(purpose: string, value: unknown): this {
    this.objects.set(purpose, value);
    return this;
  }
  setText(purpose: string, value: string): this {
    this.texts.set(purpose, value);
    return this;
  }

  async generateObject<T>(args: GenerateObjectArgs<T>): Promise<T> {
    this.calls.push({ kind: "object", role: args.role, purpose: args.purpose });
    if (!this.objects.has(args.purpose)) throw new Error(`no mock object for purpose: ${args.purpose}`);
    return args.schema.parse(this.objects.get(args.purpose));
  }

  async generateText(args: GenerateTextArgs): Promise<string> {
    this.calls.push({ kind: "text", role: args.role, purpose: args.purpose });
    if (!this.texts.has(args.purpose)) throw new Error(`no mock text for purpose: ${args.purpose}`);
    return this.texts.get(args.purpose) as string;
  }
}
