# Polish B+C — Data consistency + Robustness

> **老流程:** Codex implements per task; Claude runs the gate + reviews + commits, with a Codex design review before code and a milestone gate after. (Independent fixes from the broad code review; combined into one cycle.)

**Goal:** Close the verified data-consistency and robustness gaps from the review:
- **B1** — `getThesisStats` counts prep items across ALL runs, while `/materials` (`getPrepItems`) shows only the latest *done* run → the dashboard disagrees with the page (and counts failed-run partials).
- **B2** — a prep-pack run that fails mid-loop leaves partial `prep_item` rows (no run-level transaction).
- **C1** — an LLM timeout rejects but does NOT abort the underlying provider HTTP call (it leaks).
- **C2** — an empty Google STT result is saved as `stt_status='ok'` with a blank transcript (looks like success).
- **C3** — `serverActions.bodySizeLimit` equals the app's 15 MB guards, so multipart overhead 413s before the friendly error.
- **C4** — the Google STT `fetch` has no timeout and can hang a server action.

**Architecture:** All surgical, local-first, no new outbound. B1 scopes a SELECT; B2 wraps an existing sync loop in `db.transaction`; C1 threads an `AbortSignal` through the existing `LlmTransport` seam; C2 adds an empty-result branch; C3 is a config number; C4 adds `AbortSignal.timeout`.

**Tech Stack:** better-sqlite3, the AI SDK (`abortSignal`), `AbortController`/`AbortSignal.timeout`, Next config, vitest (mock transport / mock STT).

---

### Task 1 (B1): scope `getThesisStats` prep counts to the latest done run

**Files:** Modify `src/db/repository.ts`, `src/db/repository.prep-read.test.ts`

- [ ] **Step 1: Failing test** — append to `src/db/repository.prep-read.test.ts`:
```ts
import { getThesisStats } from "./repository"; // add to the existing import
// ...
it("getThesisStats prep counts are scoped to the latest done run (matches getPrepItems)", () => {
  const db = makeTestDb();
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO generation_run (id,thesis_id,kind,status,created_at) VALUES ('old','t1','prep_pack','done','2024-01-01T00:00:00Z');
    INSERT INTO generation_run (id,thesis_id,kind,status,created_at) VALUES ('new','t1','prep_pack','done','2024-01-02T00:00:00Z');
    INSERT INTO generation_run (id,thesis_id,kind,status,created_at) VALUES ('err','t1','prep_pack','error','2024-01-03T00:00:00Z');
    INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,status,validation_status,validator_version,source) VALUES ('o','t1','old','qa','O','verified','passed','1','generated');
    INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,status,validation_status,validator_version,source) VALUES ('n1','t1','new','qa','N1','verified','passed','1','generated');
    INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,status,validation_status,validator_version,source) VALUES ('n2','t1','new','qa','N2','needs_review','needs_review','1','generated');
    INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,status,validation_status,validator_version,source) VALUES ('e','t1','err','qa','E','unsafe','failed','1','generated');
  `);
  const s = getThesisStats(db, "t1");
  expect(s.prepTotal).toBe(2);          // only the 'new' run, not old (1) or err (1)
  expect(s.prepVerified).toBe(1);
  expect(s.prepNeedsReview).toBe(1);
  expect(s.prepUnsafe).toBe(0);         // the err-run unsafe item is excluded
  db.close();
});
```

- [ ] **Step 2: Implement** — in `src/db/repository.ts`, change `getThesisStats` so the prep counts use the latest done prep_pack run (the same subquery shape as `getPrepItems`):
```ts
export function getThesisStats(db: DB, thesisId: string): ThesisStats {
  const latestRunId =
    (db.prepare(
      "SELECT id FROM generation_run WHERE thesis_id = ? AND kind = 'prep_pack' AND status = 'done' ORDER BY created_at DESC, rowid DESC LIMIT 1",
    ).get(thesisId) as { id: string } | undefined)?.id ?? null;
  const prepCount = (status: string) =>
    latestRunId === null ? 0 : (db.prepare("SELECT count(*) c FROM prep_item WHERE generation_run_id = ? AND status = ?").get(latestRunId, status) as { c: number }).c;
  return {
    evidenceUnits: (db.prepare("SELECT count(*) c FROM evidence_unit WHERE thesis_id = ?").get(thesisId) as { c: number }).c,
    prepTotal: latestRunId === null ? 0 : (db.prepare("SELECT count(*) c FROM prep_item WHERE generation_run_id = ?").get(latestRunId) as { c: number }).c,
    prepVerified: prepCount("verified"),
    prepNeedsReview: prepCount("needs_review"),
    prepUnsafe: prepCount("unsafe"),
    prepDraft: prepCount("draft"),
    practiceRuns: (db.prepare("SELECT count(*) c FROM practice_run WHERE thesis_id = ?").get(thesisId) as { c: number }).c,
    openReviews: (db.prepare("SELECT count(*) c FROM review_item WHERE thesis_id = ? AND status = 'open'").get(thesisId) as { c: number }).c,
  };
}
```
- [ ] **Step 3: PASS**, then commit — `git commit -m "fix(pb): scope getThesisStats prep counts to the latest done run"`

---

### Task 2 (B2): make a prep-pack run atomic (no partial rows on failure)

**Files:** Modify `src/lib/llm/prep-pack-run.ts`, `src/lib/llm/prep-pack-run.test.ts`

- [ ] **Step 1: Wrap the item loop in a transaction** — in `runPrepPackGeneration`, keep `createGenerationRun`/`generatePrepPack` (the async LLM call) OUTSIDE the transaction, then run the all-sync item loop inside `db.transaction`, so an UNEXPECTED error (a non-`EvidenceBindingError` thrown by insert/validate) rolls back ALL items:
```ts
const items = await generatePrepPack(client, { thesisId, title: thesis.title, evidence });
db.transaction(() => {
  for (const item of items) {
    // ... the existing insertGeneratedPrepItem + bind (with the narrow EvidenceBindingError catch) + validate/applyValidation, unchanged ...
  }
})();
finalizeGenerationRun(db, runId, "done");
```
> The per-item `EvidenceBindingError` catch stays INSIDE the loop (a bad citation marks that item failed and the run continues — still committed). Only an unexpected throw aborts the transaction → the outer `catch` finalizes the run `'error'` with **no** orphan rows. All loop operations are synchronous (better-sqlite3), so `db.transaction` is valid.

- [ ] **Step 2: Flip the existing rollback test to prove atomicity** — `src/lib/llm/prep-pack-run.test.ts` already has *"records the run as error and rethrows when a post-bind DB read fails"* (it forces a mid-loop failure via `withPostBindEvidenceReadFailure`). It currently asserts the partial binding REMAINS — `prep_item_evidence WHERE evidence_unit_id='e1' = 1` (~line 89). B2 changes this: the unexpected post-bind failure now rolls back the whole item transaction. **Rewrite that assertion to `0`, and add `SELECT count(*) FROM prep_item WHERE thesis_id='t1'` → `0`**, while KEEPING the `generation_run` status `'error'` + error-message assertions (lines 90-95) — the run row is created/finalized OUTSIDE the tx, so it persists. This directly proves the atomicity contract. The suite's happy-path tests already confirm a successful run persists all items.

- [ ] **Step 3: PASS + typecheck**, then commit — `git commit -m "fix(pb): wrap prep-pack item loop in a transaction (atomic run)"`

---

### Task 3 (C1): abort the LLM provider call on timeout

**Files:** Modify `src/lib/llm/types.ts`, `src/lib/llm/client.ts`, `src/lib/llm/transport.ts`, `src/lib/llm/client.test.ts`

- [ ] **Step 1: Failing test** — append to `src/lib/llm/client.test.ts` (a transport whose call only settles when aborted):
```ts
it("aborts the provider call when the timeout fires", async () => {
  let seen: AbortSignal | undefined;
  const transport: LlmTransport = {
    async object() { throw new Error("unused"); },
    text(_model, _prompt, _system, signal) {
      seen = signal;
      return new Promise<string>((_res, rej) => signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    },
  };
  const client = createLlmClient(transport, { resolveModel: () => "prov/model", logCall: () => {}, timeoutMs: 10 });
  await expect(client.generateText({ role: "fast", purpose: "t", prompt: "p" })).rejects.toThrow(/timed out/);
  expect(seen?.aborted).toBe(true);
});

// AND the generateObject path (the real prep-pack/judge/examiner calls use generateObject):
it("aborts the generateObject path on timeout too", async () => {
  let seen: AbortSignal | undefined;
  const transport: LlmTransport = {
    object(_m, _s, _p, _sys, signal) { seen = signal; return new Promise((_r, rej) => signal?.addEventListener("abort", () => rej(new Error("aborted")))); },
    async text() { throw new Error("unused"); },
  };
  const client = createLlmClient(transport, { resolveModel: () => "prov/model", logCall: () => {}, timeoutMs: 10 });
  await expect(client.generateObject({ role: "hard", purpose: "t", schema: z.object({ x: z.string() }), prompt: "p" })).rejects.toThrow(/timed out/);
  expect(seen?.aborted).toBe(true);
});
```
> Add `import { z } from "zod";` to the test if not present. (The op rejects on abort, so `schema.parse` never runs.)

- [ ] **Step 2: Implement** —
  - `src/lib/llm/types.ts`: add an optional trailing `signal?: AbortSignal` to BOTH `LlmTransport` methods (optional → existing impls/mocks still satisfy the interface):
    ```ts
    object(model: string, schema: z.ZodType<unknown>, prompt: string, system?: string, signal?: AbortSignal): Promise<unknown>;
    text(model: string, prompt: string, system?: string, signal?: AbortSignal): Promise<string>;
    ```
  - `src/lib/llm/client.ts`: make `withTimeout` own an `AbortController`, abort it when the timer fires (still rejecting `LlmTimeoutError`), and pass the signal into the op; thread the signal through `run`:
    ```ts
    function withTimeout<R>(op: (signal: AbortSignal) => Promise<R>, ms: number): Promise<R> {
      const controller = new AbortController();
      return new Promise<R>((resolve, reject) => {
        const t = setTimeout(() => { controller.abort(); reject(new LlmTimeoutError(ms)); }, ms);
        op(controller.signal).then(
          (v) => { clearTimeout(t); resolve(v); },
          (e) => { clearTimeout(t); reject(e); },
        );
      });
    }
    // run(...): change `op` to `(model: string, signal: AbortSignal) => Promise<R>` and call:
    const result = await withTimeout((signal) => op(model, signal), timeoutMs);
    // generateObject: (model, signal) => { const raw = await transport.object(model, args.schema, args.prompt, args.system, signal); return args.schema.parse(raw); }
    // generateText:   (model, signal) => transport.text(model, args.prompt, args.system, signal)
    ```
  - `src/lib/llm/transport.ts`: accept the `signal` and pass `abortSignal: signal` to both `generateText` calls.
    ```ts
    async object(model, schema, prompt, system, signal) {
      const { output } = await generateText({ model, output: Output.object({ schema: schema as z.ZodType<unknown> }), prompt, instructions: system, abortSignal: signal });
      return output;
    },
    async text(model, prompt, system, signal) {
      const { text } = await generateText({ model, prompt, instructions: system, abortSignal: signal });
      return text;
    },
    ```

- [ ] **Step 3: PASS + typecheck**, then commit — `git commit -m "fix(pc): abort the LLM provider call on timeout (thread AbortSignal)"`

---

### Task 4 (C2+C3+C4): empty STT → error; STT fetch timeout; bodySizeLimit headroom

**Files:** Modify `src/lib/stt/transcribe.ts`, `src/lib/stt/google.ts`, `next.config.ts`, `src/lib/stt/transcribe.test.ts`

- [ ] **Step 1 (C2): empty transcript is not success** — in `src/lib/stt/transcribe.ts`, trim the result and treat empty as an error (don't write an `ok` blank transcript):
```ts
const transcript = result.transcript.trim();
if (!transcript) {
  await recordingRepository.setRecordingError(db, opts.recordingId, "No speech was recognized in the recording.");
  return { status: "error" };
}
await recordingRepository.setRecordingTranscript(db, opts.recordingId, transcript);
return { status: "ok", transcript };
```
  Test (`src/lib/stt/transcribe.test.ts`): a mock `SttTransport` returning `{ transcript: "  " }` → `transcribeRecording` returns `{ status: "error" }` and the recording row has `stt_status='error'` (not `'ok'`). (Use the existing test's recording seed + mock pattern.)
  > Scope note: the recording row stores the "No speech was recognized" message via `setRecordingError`, but `transcribeAnswerAction` (recording.ts:47) maps all non-`ok` results to its existing GENERIC inline message — that's accepted (no return-type change). The fix's value is that an empty result is now an honest *error* instead of a silent blank success.

- [ ] **Step 2 (C4): STT fetch timeout** — in `src/lib/stt/google.ts`, add a timeout to the request so a hung provider can't block the action:
```ts
const response = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(key)}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ config, audio: { content: audio.toString("base64") } }),
  signal: AbortSignal.timeout(20_000),
});
```
  Test: the existing `src/lib/stt/google.test.ts` already destructures `[url, init]` from the fetch mock call — add `expect(init.signal).toBeInstanceOf(AbortSignal);` (cheap, catches a dropped timeout).

- [ ] **Step 3 (C3): bodySizeLimit headroom** — in `next.config.ts`, raise the limit above the app's 15 MB file guards so multipart overhead doesn't 413 before the friendly inline error:
```ts
serverActions: { bodySizeLimit: "20mb" }, // app guards cap files at 15 MB; leave headroom for multipart overhead
```
  Also update the now-stale comments at `src/app/_actions/thesis.ts:11-12` and `src/app/_actions/recording.ts:13` — they currently say the 15 MB guard "keep in sync with serverActions.bodySizeLimit". Reword to: the guard is intentionally BELOW the 20 MB Server Action limit (multipart headroom).

- [ ] **Step 4: PASS + typecheck + build**, then commit — `git commit -m "fix(pc): empty STT result -> error, STT fetch timeout, bodySizeLimit headroom"`

---

## Gate + smoke (Claude)

```bash
npm run check   # B1 stats test, B2 happy-path, C1 abort test, C2 empty-STT test + existing suite
npm run build   # routes compile; next.config valid
```
Dev smoke (AI off): inject an old-done + latest-done + error run with items → the dashboard prep counts match `/materials` (latest done only). (C1/C4 abort + C3 are build/read-verified; C2 covered by the unit test.)

## Red lines

1. **Local-first, no new outbound (red lines #2/#3):** C1/C4 only ADD an abort signal/timeout to existing calls (they never start a new request); B1/B2 are pure DB reads/writes; C3 is a size limit. Nothing new leaves the machine.
2. **Graceful degrade (#4):** C2 turns a silent empty success into a clear "no speech recognized" error; the disabled/skipped STT paths are unchanged. C1's timeout still rejects `LlmTimeoutError` (AI-disabled/degrade paths untouched).
3. **No behavior change to verified content:** B1/B2 only fix counts/atomicity; no validator or evidence-binding change.

## Self-review

- **B1 consistency:** `getThesisStats` now uses the exact latest-done-run subquery as `getPrepItems`, so the dashboard and `/materials` agree; no done run → all prep counts 0 (matches `getPrepItems` returning `[]`).
- **B2 atomicity:** the async `generatePrepPack` stays outside `db.transaction`; the all-sync persist/bind/validate loop is wrapped; the narrow `EvidenceBindingError` catch (a normal per-item outcome) stays inside and does not abort the run.
- **C1 backward-compat:** `signal?` is optional on `LlmTransport`, so the mock transport and any existing impl still satisfy the interface; the client passes its own controller's signal and aborts on timeout while preserving `LlmTimeoutError`.
- **C2/C4 scope:** empty-result handling lives in `transcribeRecording` (transport-agnostic — covers any STT provider); the fetch timeout is provider-specific in `google.ts`.
- **Open question for Codex review:** is C1 (threading abort through the `LlmTransport` seam) worth the interface change for a local single-user app, or is the leaked-request risk acceptable to defer? Recommendation: include it — it's a clean, optional, backward-compatible addition and the right robustness posture. Also: is `AbortSignal.timeout(20_000)` (C4) a sensible STT ceiling?
