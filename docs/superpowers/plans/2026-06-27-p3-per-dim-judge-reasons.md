# Polish P3 — Per-dimension judge reasons

> **老流程:** Codex implements per task; Claude runs the gate + reviews + commits, with a Codex design review before code and a milestone gate after. (Polish item — touches the judge/evidence path, so it gets a milestone gate.)

**Goal:** Today the judge returns one overall `diagnosis`, and `applyJudgeResult` stores that *same* string as the `reason` for every weak dimension (repository.ts:343). Make the judge give a **one-sentence reason per dimension** (why that score, judged only against the bound evidence), store the per-dim reason in the existing `review_item.reason` column, and surface the weak-dimension reasons on the practice result (the review queue already renders `it.reason`).

**Architecture:** Schema-first. Extend `JudgeResultSchema` with `reasons` (one string per dimension) + ask for them in the prompt; thread `reasons` through `runJudge` into `applyJudgeResult`, which stores `reasons[dim]` (not `diagnosis`) per review item. A new read `getRunReviewItems` lets the practice page show this run's weak-dim reasons. **No migration** — `review_item.reason` already exists; the review page already displays it. Judge stays grounded only in bound evidence (red line #1).

**Tech Stack:** zod (AI SDK `Output.object`), better-sqlite3, Next 16 RSC, Tailwind, vitest (mock LLM — no real model calls).

> **Scope:** per-dimension reasons for the **weak** dimensions (score ≤ 2 → review_item, the ones needing attention), shown on practice + review. The judge produces a reason for all five (clean schema); only the weak ones are stored/shown. NOT in scope: storing all five reasons on `practice_run` (no need — strong dims don't need a "why"), changing the score scale, editing reasons.

---

## Contracts

```ts
// src/lib/llm/judge.ts
export const JudgeReasonsSchema: z.ZodObject<...>; // { evidence, clarity, completeness, boundary, delivery: string }
export const JudgeResultSchema = z.object({ scores, reasons, diagnosis, rewrite, follow_ups });

// src/db/repository.ts
export function applyJudgeResult(db, input: { ...; reasons: Record<string, string>; ... }): string[]; // store reasons[dim] per review item
export type RunReviewItem = { dimension: string; score: number; reason: string | null };
export function getRunReviewItems(db: DB, practiceRunId: string): RunReviewItem[];
```

## File structure

- **Modify** `src/lib/llm/judge.ts` — `JudgeReasonsSchema`, add `reasons` to `JudgeResultSchema`, ask for per-dim reasons in `buildJudgePrompt`.
- **Modify** `src/lib/llm/judge-run.ts` — pass `reasons: result.reasons` to `applyJudgeResult`.
- **Modify** `src/db/repository.ts` — `applyJudgeResult` stores `reasons[dim]`; add `getRunReviewItems`.
- **Modify** `src/app/practice/page.tsx` — a "weak dimensions" reasons section.
- **Modify** tests: `src/db/repository.judge.test.ts` (per-dim reason assertions + `getRunReviewItems`), `src/lib/llm/judge-run.test.ts` (mock gains `reasons`), `src/lib/llm/judge.test.ts` (`valid` fixture gains `reasons` + a rejection case + the prompt assertion).

---

### Task 1: judge produces per-dim reasons → stored per review item

**Files:** Modify `src/lib/llm/judge.ts`, `src/lib/llm/judge-run.ts`, `src/db/repository.ts`, `src/db/repository.judge.test.ts`, `src/lib/llm/judge-run.test.ts`

- [ ] **Step 1: Update the failing tests** — in `src/db/repository.judge.test.ts`, add `reasons` to each `applyJudgeResult` call and assert the stored reason is **per-dimension**, not the diagnosis:

```ts
// the scores already make completeness=1 and evidence=2 the reviewed dims:
const reasons = { evidence: "cited no source", clarity: "ok", completeness: "skipped the method", boundary: "ok", delivery: "ok" };
const reviewed = applyJudgeResult(db, { practiceRunId: id, thesisId: "t1", scores, reasons, diagnosis: "weak evidence", rewrite: "better", followUps: ["f1"] });
// ...
expect(items).toEqual([
  { dimension: "completeness", score: 1, reason: "skipped the method", status: "open" }, // per-dim, NOT "weak evidence"
  { dimension: "evidence", score: 2, reason: "cited no source", status: "open" },
]);
```
…and add `reasons` to the second `applyJudgeResult` call (line ~45-46). Add a test for the new read:

```ts
it("getRunReviewItems returns this run's weak dimensions with per-dim reasons (worst first)", () => {
  // (reuse the run seeded above; after applyJudgeResult)
  const weak = getRunReviewItems(db, id);
  expect(weak).toEqual([
    { dimension: "completeness", score: 1, reason: "skipped the method" },
    { dimension: "evidence", score: 2, reason: "cited no source" },
  ]);
});
```

In `src/lib/llm/judge-run.test.ts`, add `reasons` to the mock judge output so it satisfies the schema:

```ts
const MOCK = {
  scores: { evidence: 2, clarity: 4, completeness: 4, boundary: 5, delivery: 4 },
  reasons: { evidence: "no citation", clarity: "clear", completeness: "covers it", boundary: "scoped", delivery: "fluent" },
  diagnosis: "weak grounding", rewrite: "better answer", follow_ups: ["f1"],
};
```
(and, if that suite asserts the queued reason, assert it is `"no citation"` for the evidence review item).

In `src/lib/llm/judge.test.ts` (the direct schema/prompt suite — adding required `reasons` will otherwise break it): add `reasons` (one non-empty string per dim) to the `valid` fixture; add a rejection assertion (`JudgeResultSchema.safeParse({ ...valid, reasons: { ...valid.reasons, evidence: "" } }).success === false`, and a missing-`reasons` case); and assert `buildJudgePrompt` now requests per-dimension reasons (e.g. `expect(p.toLowerCase()).toContain("reason")`) while still containing `"do not use outside knowledge"`.

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3a: Extend the judge schema + prompt** — `src/lib/llm/judge.ts`:

```ts
export const JudgeReasonsSchema = z.object({
  evidence: z.string().min(1),
  clarity: z.string().min(1),
  completeness: z.string().min(1),
  boundary: z.string().min(1),
  delivery: z.string().min(1),
});
export const JudgeResultSchema = z.object({
  scores: JudgeScoresSchema,
  reasons: JudgeReasonsSchema,
  diagnosis: z.string().min(1),
  rewrite: z.string().min(1),
  follow_ups: z.array(z.string()),
});
export type JudgeReasons = z.infer<typeof JudgeReasonsSchema>;
```
In `buildJudgePrompt`, after the dimension list, add:
```
"For EACH dimension, also return reasons.<dimension>: a one-sentence reason for that score (what was missing or strong), judged ONLY against the evidence above.",
```

- [ ] **Step 3b: Thread reasons through `runJudge`** — `src/lib/llm/judge-run.ts`, add to the `applyJudgeResult` call:
```ts
    scores: result.scores,
    reasons: result.reasons,
    diagnosis: result.diagnosis,
```

- [ ] **Step 3c: Store per-dim reason + the new read** — `src/db/repository.ts`:
  - Add `reasons: Record<string, string>;` to `applyJudgeResult`'s `input` type.
  - In the `review_item` INSERT loop, replace `input.diagnosis` with the per-dim reason (fallback to diagnosis if the model omitted one):
    ```ts
    ins.run(randomUUID(), input.thesisId, input.practiceRunId, r.dim, r.score, input.reasons[r.dim]?.trim() || input.diagnosis);
    ```
    (`?.trim() ||` — an empty/whitespace reason from the model falls back to the diagnosis, not just a missing key.)
  - Append the read (it encodes the ≤2 threshold itself, not relying on the insert invariant):
    ```ts
    export type RunReviewItem = { dimension: string; score: number; reason: string | null };
    export function getRunReviewItems(db: DB, practiceRunId: string): RunReviewItem[] {
      return db
        .prepare("SELECT dimension, score, reason FROM review_item WHERE practice_run_id = ? AND score <= ? ORDER BY score ASC, dimension")
        .all(practiceRunId, REVIEW_SCORE_THRESHOLD) as RunReviewItem[];
    }
    ```

- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(p3): judge returns per-dimension reasons, stored per review item"`

---

### Task 2: surface the weak-dimension reasons on the practice result

**Files:** Modify `src/app/practice/page.tsx`

- [ ] **Step 1: Read + render** — import `getRunReviewItems`; inside the judged branch (`run.scores` present) compute `const weak = getRunReviewItems(db, run.id);` and render after the score grid (before Diagnosis):

```tsx
{weak.length > 0 ? (
  <div>
    <h3 className="text-sm font-medium">Why the weak dimensions scored low</h3>
    <ul className="mt-1 flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
      {weak.map((w) => (
        <li key={w.dimension}><span className="font-medium text-red-600 dark:text-red-400">{w.dimension} · {w.score}/5</span>{w.reason ? ` — ${w.reason}` : ""}</li>
      ))}
    </ul>
  </div>
) : null}
```

> The review queue (`/review`) already renders `it.reason` (review/page.tsx:41) — once Task 1 stores per-dim reasons, the queue shows them with no change. The practice page now shows the same per-dim reasons for the current run.

- [ ] **Step 2: Typecheck + build** — `npx tsc --noEmit` (exit 0). (Claude runs `npm run build`.)
- [ ] **Step 3: Commit** — `git commit -m "feat(p3): show per-dimension weak-spot reasons on the practice result"`

---

## Gate + smoke (Claude)

```bash
npm run check   # judge/repository tests updated to per-dim reasons; getRunReviewItems test
npm run build   # /practice + /review Dynamic
```
Dev smoke (AI off, inject a judged run with review_items via node): `/practice` shows the latest run with a "Why the weak dimensions scored low" list giving a DIFFERENT reason per weak dim; `/review` lists each weak dim with its own reason (not a repeated diagnosis).

## Red lines

1. **Judge grounded only in bound evidence (red line #1):** the prompt still says "judged ONLY against the evidence"; per-dim reasons are produced under the same constraint. No new model surface, no outside knowledge.
2. **LLM via the unified layer:** `judgeAnswer` still calls `client.generateObject` with the extended schema — no scattered SDK calls; tests use the mock client (no real model).
3. **No migration / no data risk:** `review_item.reason` already exists; only what's written into it changes (per-dim vs duplicated diagnosis). Idempotent re-judge still DELETEs+re-INSERTs review items.
4. **Graceful degrade:** AI disabled → no judging → no reasons; the practice/review pages render without them, unchanged.

## Self-review

- **Smallest correct change:** the column, the `getReviewItems` SELECT, and the review-page render already exist — P3 fills `reason` with per-dim content and adds one read + one practice-page section. `applyJudgeResult`'s `?? input.diagnosis` fallback keeps it safe if the model omits a reason.
- **Tests updated, not just added:** the existing `repository.judge.test.ts` asserted `reason === diagnosis`; it now asserts per-dim reasons (the behavior change is locked by a test). `judge-run.test.ts`'s mock gains `reasons` so the schema is satisfied.
- **Type consistency:** `JudgeReasonsSchema` keys match `DIMENSIONS`; `applyJudgeResult` reads `reasons[dim]` for the same `REVIEW_DIMENSIONS` it scores; `getRunReviewItems` returns only this run's items (≤2, worst-first).
- **Open question for Codex review:** should `JudgeResultSchema.reasons` be required for all five dims (current — simplest, model always reasons per dim) or optional/partial (only weak dims)? Required is simpler and the `?? diagnosis` fallback covers a missing key; strong-dim reasons are just unused.
