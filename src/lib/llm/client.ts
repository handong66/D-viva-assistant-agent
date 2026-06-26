import type { GenerateObjectArgs, GenerateTextArgs, LlmClient, LlmRole, LlmTransport } from "./types";

export type AiCallLog = {
  thesisId?: string;
  purpose: string;
  provider: string;
  model: string;
  latencyMs: number;
  status: "ok" | "error" | "timeout";
  error?: string;
};

export type ClientDeps = {
  resolveModel: (role: LlmRole) => string;
  logCall: (entry: AiCallLog) => void;
  /** Per-call timeout; defaults to 25s (spec §8). */
  timeoutMs?: number;
};

export class LlmTimeoutError extends Error {
  constructor(ms: number) {
    super(`LLM call timed out after ${ms}ms`);
    this.name = "LlmTimeoutError";
  }
}

function providerOf(model: string): string {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : "unknown";
}

function withTimeout<R>(p: Promise<R>, ms: number): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    const t = setTimeout(() => reject(new LlmTimeoutError(ms)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export function createLlmClient(transport: LlmTransport, deps: ClientDeps): LlmClient {
  const timeoutMs = deps.timeoutMs ?? 25_000;
  async function run<R>(
    role: LlmRole,
    purpose: string,
    thesisId: string | undefined,
    op: (model: string) => Promise<R>,
  ): Promise<R> {
    const model = deps.resolveModel(role);
    const provider = providerOf(model);
    const started = Date.now();
    try {
      const result = await withTimeout(op(model), timeoutMs);
      deps.logCall({ thesisId, purpose, provider, model, latencyMs: Date.now() - started, status: "ok" });
      return result;
    } catch (err) {
      const status = err instanceof LlmTimeoutError ? "timeout" : "error";
      deps.logCall({
        thesisId, purpose, provider, model, latencyMs: Date.now() - started,
        status, error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  return {
    enabled: true,
    generateObject<T>(args: GenerateObjectArgs<T>): Promise<T> {
      return run(args.role, args.purpose, args.thesisId, async (model) => {
        const raw = await transport.object(model, args.schema, args.prompt, args.system);
        return args.schema.parse(raw);
      });
    },
    generateText(args: GenerateTextArgs): Promise<string> {
      return run(args.role, args.purpose, args.thesisId, (model) =>
        transport.text(model, args.prompt, args.system),
      );
    },
  };
}
