# M4c — Practice (examiner → answer → judge) + Review Queue Implementation Plan

> **For agentic workers:** This project runs the Claude↔Codex 老流程 (see `AGENTS.md`): **Codex implements** each task via `codex:codex-rescue` (`--write`); **Claude runs tests + reviews + commits** per task and at a milestone gate (绿测试≠Done). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Surface M3a (examiner) + M3b (judge) in the UI (§7 ⑤⑥): on `/practice`, generate an evidence-grounded question for the active thesis, type an answer, get 5-dimension scores + diagnosis + English rewrite + follow-ups; on `/review`, see the low-score (≤2) queue.

**Architecture:** Reuse `runExaminerQuestion` + `runJudge` unchanged (both evidence-bound; judge sees only the run's bound evidence). The `/practice` page shows the **latest** `practice_run` for the active thesis (the "current" one); generating creates a new run → it becomes current; answering judges that latest run. Both AI actions guard `effectiveAiEnabled && gatewayConfigured` (mirroring `getLlmClient`) and degrade with a friendly message. The submit action carries the shown question's run id in the form and cross-checks it belongs to the active thesis before judging — so the answer binds to the exact question the user saw, and a tampered or cross-thesis id is rejected.

**Tech Stack:** Next 16 App Router (RSC + Server Actions), React 19 (`useActionState`), Tailwind v4, better-sqlite3, vitest. AI only via `lib/llm` through the bridge; DB only via `appContext`; evidence-binding + judge grounding untouched.

> **M4 decomposition:** M4a shell+import ✓ → M4b generate+materials ✓ → **M4c practice+judge+review (this plan)** → M4d today/library/settings.
>
> **v1 scope notes (deferred):** the kind selector offers only the kinds that need no extra input — `random`, `cross_section`, `hostile`, `boundary`. `by_section` (needs a section picker) and `followup` (needs a prior answered run) come later. STT/recording answers are M5; v1 answers are typed text. Editing/"mark fixed" on review items is a later increment.

> **Revised after Codex design-review round 1** (CONDITIONAL GO → fixes integrated): **P1** the latest-run answer model could misbind (generate Q2 → submit Q1's answer judges Q2). Fix: `AnswerForm` carries a hidden `practiceRunId`; `submitAnswerAction` cross-checks `WHERE id=? AND thesis_id=?` (active thesis) before saving/judging that exact run — no trust in the raw id. **P2** `getReviewItems` also filters `score <= 2` and scopes its JOIN to the same thesis. (Codex confirmed judge grounding, both AI guards, the `"use server"` shape, `noUncheckedIndexedAccess`, and red lines as already correct.)

---

## Contracts

```ts
// src/db/repository.ts
export type PracticeRunView = {
  id: string; question: string; questionKind: string;
  answerText: string | null; transcript: string | null;
  scores: Record<string, number> | null; diagnosis: string | null; rewrite: string | null; followUps: string[] | null;
  status: string;
};
export function getLatestPracticeRun(db: DB, thesisId: string): PracticeRunView | undefined;

export type ReviewItemView = { id: string; dimension: string; score: number; reason: string | null; question: string; practiceRunId: string };
export function getReviewItems(db: DB, thesisId: string): ReviewItemView[];

export function saveAnswer(db: DB, practiceRunId: string, answerText: string): void;

// src/app/_actions/practice.ts — "use server"
export type PracticeState = { error: string | null };
export async function startPracticeAction(prev: PracticeState, formData: FormData): Promise<PracticeState>;
export async function submitAnswerAction(prev: PracticeState, formData: FormData): Promise<PracticeState>;
```

## File structure

- **Modify** `src/db/repository.ts` (+`src/db/repository.practice-read.test.ts`) — `getLatestPracticeRun`, `getReviewItems`, `saveAnswer`.
- **Create** `src/app/_actions/practice.ts` — the two Server Actions.
- **Create** `src/app/practice/{page.tsx,start-form.tsx,answer-form.tsx}` — practice UI.
- **Create** `src/app/review/page.tsx`; **Modify** `src/app/layout.tsx` — Practice + Review nav links.

---

### Task 1: Repository — latest practice run, review queue, save answer

**Files:** Modify `src/db/repository.ts`, Create `src/db/repository.practice-read.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/db/repository.practice-read.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { getLatestPracticeRun, getReviewItems, saveAnswer, insertPracticeRunWithEvidence } from "./repository";

function seedThesis(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c1','t1',0,'S','x',1,'h1');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e1','t1','c1','S',0,1,'evidence','h1');
  `);
}

describe("practice reads", () => {
  it("getLatestPracticeRun returns the most recent run with parsed scores/follow_ups", () => {
    const db = makeTestDb(); seedThesis(db);
    insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q old", questionKind: "random" }, ["e1"]);
    const newId = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q new", questionKind: "hostile" }, ["e1"]);
    db.prepare("UPDATE practice_run SET scores=?, follow_ups=?, diagnosis=? WHERE id=?")
      .run(JSON.stringify({ evidence: 2, clarity: 4, completeness: 3, boundary: 5, delivery: 4 }), JSON.stringify(["dig deeper?"]), "weak grounding", newId);

    const run = getLatestPracticeRun(db, "t1")!;
    expect(run.question).toBe("Q new");
    expect(run.scores).toEqual({ evidence: 2, clarity: 4, completeness: 3, boundary: 5, delivery: 4 });
    expect(run.followUps).toEqual(["dig deeper?"]);
    expect(getLatestPracticeRun(makeTestDb(), "t1")).toBeUndefined();
    db.close();
  });

  it("saveAnswer sets answer_text on the run", () => {
    const db = makeTestDb(); seedThesis(db);
    const id = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q", questionKind: "random" }, ["e1"]);
    saveAnswer(db, id, "  my typed answer  ");
    expect((db.prepare("SELECT answer_text FROM practice_run WHERE id=?").get(id) as { answer_text: string }).answer_text).toBe("my typed answer");
    db.close();
  });

  it("getReviewItems returns open items joined to their question, worst score first", () => {
    const db = makeTestDb(); seedThesis(db);
    const id = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Why 81.3%?", questionKind: "random" }, ["e1"]);
    db.exec(`
      INSERT INTO review_item (id,thesis_id,practice_run_id,dimension,score,reason,status) VALUES ('ri1','t1','${id}','clarity',2,'unclear','open');
      INSERT INTO review_item (id,thesis_id,practice_run_id,dimension,score,reason,status) VALUES ('ri2','t1','${id}','evidence',1,'unsupported','open');
      INSERT INTO review_item (id,thesis_id,practice_run_id,dimension,score,reason,status) VALUES ('ri3','t1','${id}','boundary',2,'fixed already','fixed');
      INSERT INTO review_item (id,thesis_id,practice_run_id,dimension,score,reason,status) VALUES ('ri4','t1','${id}','completeness',3,'ok-ish','open');
    `);
    const items = getReviewItems(db, "t1");
    expect(items.map((i) => i.dimension)).toEqual(["evidence", "clarity"]); // open AND score<=2; 'ri3' fixed + 'ri4' score 3 are excluded
    expect(items[0]).toMatchObject({ dimension: "evidence", score: 1, reason: "unsupported", question: "Why 81.3%?" });
    db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/db/repository.practice-read.test.ts` — FAIL (not exported).

- [ ] **Step 3: Implement** — append to `src/db/repository.ts`:

```ts
export type PracticeRunView = {
  id: string; question: string; questionKind: string;
  answerText: string | null; transcript: string | null;
  scores: Record<string, number> | null; diagnosis: string | null; rewrite: string | null; followUps: string[] | null;
  status: string;
};

export function getLatestPracticeRun(db: DB, thesisId: string): PracticeRunView | undefined {
  const row = db
    .prepare(
      `SELECT id, question, question_kind, answer_text, transcript, scores, diagnosis, rewrite, follow_ups, status
         FROM practice_run WHERE thesis_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(thesisId) as
    | { id: string; question: string; question_kind: string; answer_text: string | null; transcript: string | null; scores: string | null; diagnosis: string | null; rewrite: string | null; follow_ups: string | null; status: string }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id, question: row.question, questionKind: row.question_kind,
    answerText: row.answer_text, transcript: row.transcript,
    scores: row.scores ? (JSON.parse(row.scores) as Record<string, number>) : null,
    diagnosis: row.diagnosis, rewrite: row.rewrite,
    followUps: row.follow_ups ? (JSON.parse(row.follow_ups) as string[]) : null,
    status: row.status,
  };
}

export type ReviewItemView = { id: string; dimension: string; score: number; reason: string | null; question: string; practiceRunId: string };

export function getReviewItems(db: DB, thesisId: string): ReviewItemView[] {
  const rows = db
    .prepare(
      `SELECT ri.id, ri.dimension, ri.score, ri.reason, ri.practice_run_id, pr.question
         FROM review_item ri JOIN practice_run pr ON pr.id = ri.practice_run_id AND pr.thesis_id = ri.thesis_id
        WHERE ri.thesis_id = ? AND ri.status = 'open' AND ri.score <= 2
        ORDER BY ri.score ASC, ri.created_at DESC, ri.id`,
    )
    .all(thesisId) as { id: string; dimension: string; score: number; reason: string | null; practice_run_id: string; question: string }[];
  return rows.map((r) => ({ id: r.id, dimension: r.dimension, score: r.score, reason: r.reason, question: r.question, practiceRunId: r.practice_run_id }));
}

export function saveAnswer(db: DB, practiceRunId: string, answerText: string): void {
  db.prepare("UPDATE practice_run SET answer_text = ? WHERE id = ?").run(answerText.trim(), practiceRunId);
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (3).
- [ ] **Step 5: Commit** — `git commit -m "feat(m4c): repository getLatestPracticeRun + getReviewItems + saveAnswer (Task 1)"`

---

### Task 2: Server Actions — start practice (examiner) + submit answer (judge)

**Files:** Create `src/app/_actions/practice.ts`

No unit test (uses `appContext` + db singleton; `runExaminerQuestion`/`runJudge` are M3a/M3b-unit-tested). Verified by build + smoke.

- [ ] **Step 1: Implement**

```ts
// src/app/_actions/practice.ts
"use server";
import { revalidatePath } from "next/cache";
import { appContext, appLlmClient } from "../../lib/server/context";
import { getActiveThesis, saveAnswer } from "../../db/repository";
import { runExaminerQuestion } from "../../lib/llm/examiner-run";
import { runJudge } from "../../lib/llm/judge-run";
import { type QuestionKind } from "../../lib/llm/examiner";

export type PracticeState = { error: string | null };

const AI_OFF = "AI is disabled. Set AI_GATEWAY_API_KEY and VIVA_AI_ENABLED=true to practice with the AI examiner.";
// v1 selectable kinds (no extra input): random, cross_section, hostile, boundary.
const SELECTABLE: ReadonlySet<string> = new Set(["random", "cross_section", "hostile", "boundary"]);

export async function startPracticeAction(_prev: PracticeState, formData: FormData): Promise<PracticeState> {
  const { db, config } = await appContext();
  const thesis = getActiveThesis(db);
  if (!thesis) return { error: "Import a thesis first." };

  const kind = String(formData.get("kind") ?? "");
  if (!SELECTABLE.has(kind)) return { error: "Pick a question type." };
  if (!config.effectiveAiEnabled || !config.gatewayConfigured) return { error: AI_OFF };

  try {
    const client = await appLlmClient({ db, config });
    await runExaminerQuestion(db, client, thesis.id, kind as QuestionKind);
    revalidatePath("/practice");
    return { error: null };
  } catch (error) {
    console.error("[startPracticeAction]", error);
    return { error: "Could not generate a question. Please try again." };
  }
}

export async function submitAnswerAction(_prev: PracticeState, formData: FormData): Promise<PracticeState> {
  const { db, config } = await appContext();
  const thesis = getActiveThesis(db);
  if (!thesis) return { error: "Import a thesis first." };

  const answer = String(formData.get("answer") ?? "").trim();
  if (!answer) return { error: "Type an answer first." };

  // Judge the SPECIFIC question the user was shown (carried in the form), cross-checked to
  // the active thesis — so generating another question elsewhere can't misbind the answer,
  // and a tampered/cross-thesis id is rejected.
  const runId = String(formData.get("practiceRunId") ?? "");
  const owned = db.prepare("SELECT id FROM practice_run WHERE id = ? AND thesis_id = ?").get(runId, thesis.id) as { id: string } | undefined;
  if (!owned) return { error: "That question is no longer available. Generate a new one." };
  if (!config.effectiveAiEnabled || !config.gatewayConfigured) return { error: AI_OFF };

  try {
    saveAnswer(db, owned.id, answer);
    const client = await appLlmClient({ db, config });
    await runJudge(db, client, owned.id);
    revalidatePath("/practice");
    revalidatePath("/review");
    return { error: null };
  } catch (error) {
    console.error("[submitAnswerAction]", error);
    return { error: "Could not score your answer. Please try again." };
  }
}
```

> A `"use server"` file may export ONLY async functions, so `SELECTABLE` stays a module-local const (not exported) and the form hard-codes its 4 kinds (`start-form.tsx` `KINDS`). Confirm `runExaminerQuestion(db, client, thesisId, kind)` and `runJudge(db, client, practiceRunId)` signatures match (they do — M3a/M3b).

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` — exit 0.
- [ ] **Step 3: Commit** — `git commit -m "feat(m4c): startPractice + submitAnswer server actions (AI-guarded) (Task 2)"`

---

### Task 3: Practice page + start/answer forms + score display

**Files:** Create `src/app/practice/page.tsx`, `src/app/practice/start-form.tsx`, `src/app/practice/answer-form.tsx`

- [ ] **Step 1: Implement the start form (client)**

```tsx
// src/app/practice/start-form.tsx
"use client";
import { useActionState } from "react";
import { startPracticeAction, type PracticeState } from "../_actions/practice";

const initial: PracticeState = { error: null };
const KINDS = [
  { value: "random", label: "Random" },
  { value: "cross_section", label: "Cross-section" },
  { value: "hostile", label: "Hostile" },
  { value: "boundary", label: "Boundary" },
];

export function StartForm() {
  const [state, action, pending] = useActionState(startPracticeAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Question type</span>
        <select name="kind" defaultValue="random" className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </label>
      <button type="submit" disabled={pending} className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950">
        {pending ? "Generating…" : "Generate question"}
      </button>
      {state.error ? <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p> : null}
    </form>
  );
}
```

- [ ] **Step 2: Implement the answer form (client)**

```tsx
// src/app/practice/answer-form.tsx
"use client";
import { useActionState } from "react";
import { submitAnswerAction, type PracticeState } from "../_actions/practice";

const initial: PracticeState = { error: null };

export function AnswerForm({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState(submitAnswerAction, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="practiceRunId" value={runId} />
      <textarea name="answer" rows={8} required placeholder="Type your answer…" className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      <button type="submit" disabled={pending} className="self-start rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950">
        {pending ? "Scoring…" : "Submit answer"}
      </button>
      {state.error ? <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p> : null}
    </form>
  );
}
```

- [ ] **Step 3: Implement the practice page (RSC)**

```tsx
// src/app/practice/page.tsx
import Link from "next/link";
import { appContext } from "../../lib/server/context";
import { getActiveThesis, getLatestPracticeRun } from "../../db/repository";
import { StartForm } from "./start-form";
import { AnswerForm } from "./answer-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIMS = ["evidence", "clarity", "completeness", "boundary", "delivery"] as const;

export default async function PracticePage() {
  const { db } = await appContext();
  const thesis = getActiveThesis(db);
  if (!thesis) {
    return (
      <section className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold">Practice</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Import a thesis first.</p>
        <Link href="/import" className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">Import a thesis</Link>
      </section>
    );
  }

  const run = getLatestPracticeRun(db, thesis.id);
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Practice</h1>
        <StartForm />
      </div>

      {!run ? (
        <p className="text-zinc-600 dark:text-zinc-400">Generate a question to begin.</p>
      ) : (
        <article className="flex flex-col gap-5 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{run.questionKind.replace("_", " ")} question</span>
            <p className="mt-1 font-medium">{run.question}</p>
          </div>

          {!run.scores ? (
            <AnswerForm runId={run.id} />
          ) : (
            <div className="flex flex-col gap-4">
              {run.answerText ? <p className="text-sm text-zinc-600 dark:text-zinc-400"><span className="font-medium text-zinc-900 dark:text-zinc-100">Your answer:</span> {run.answerText}</p> : null}
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {DIMS.map((d) => (
                  <div key={d} className="rounded-md border border-zinc-200 p-2 text-center dark:border-zinc-800">
                    <dt className="text-[11px] uppercase text-zinc-500">{d}</dt>
                    <dd className={`text-lg font-semibold ${run.scores && run.scores[d] !== undefined && run.scores[d]! <= 2 ? "text-red-600 dark:text-red-400" : ""}`}>{run.scores?.[d] ?? "–"}</dd>
                  </div>
                ))}
              </dl>
              {run.diagnosis ? <Field label="Diagnosis">{run.diagnosis}</Field> : null}
              {run.rewrite ? <Field label="Suggested rewrite">{run.rewrite}</Field> : null}
              {run.followUps && run.followUps.length > 0 ? (
                <div>
                  <h3 className="text-sm font-medium">Follow-up questions</h3>
                  <ul className="mt-1 list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">{run.followUps.map((f, i) => <li key={i}>{f}</li>)}</ul>
                </div>
              ) : null}
            </div>
          )}
        </article>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{label}</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{children}</p>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + build** — `npx tsc --noEmit` (exit 0).
- [ ] **Step 5: Commit** — `git commit -m "feat(m4c): practice page + start/answer forms + score display (Task 3)"`

---

### Task 4: Review queue page + nav links

**Files:** Create `src/app/review/page.tsx`, Modify `src/app/layout.tsx`

- [ ] **Step 1: Add nav links** — in `src/app/layout.tsx`, add to `NAV` (after Materials): `{ href: "/practice", label: "Practice" }`, `{ href: "/review", label: "Review" }`.

- [ ] **Step 2: Implement the review page**

```tsx
// src/app/review/page.tsx
import Link from "next/link";
import { appContext } from "../../lib/server/context";
import { getActiveThesis, getReviewItems } from "../../db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { db } = await appContext();
  const thesis = getActiveThesis(db);
  if (!thesis) {
    return (
      <section className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Import a thesis first.</p>
        <Link href="/import" className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">Import a thesis</Link>
      </section>
    );
  }

  const items = getReviewItems(db, thesis.id);
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Dimensions scored 2 or below — worth another pass. <Link href="/practice" className="underline">Practice more →</Link></p>
      </div>

      {items.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">Nothing to review. Answer some practice questions first, or you are all caught up.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((it) => (
            <li key={it.id} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300">{it.dimension} · {it.score}/5</span>
              </div>
              <p className="mt-2 text-sm font-medium">{it.question}</p>
              {it.reason ? <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{it.reason}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Typecheck + build** — `npx tsc --noEmit` (exit 0). (Claude runs `npm run build`.)
- [ ] **Step 4: Commit** — `git commit -m "feat(m4c): review queue page + Practice/Review nav (Task 4)"`

---

## Full-suite gate + manual smoke (Claude runs; Codex cannot run npm/next)

```bash
npm run check   # typecheck + lint + vitest (incl. the 3 practice-read tests)
npm run build   # Next prod build green (/practice + /review Dynamic)
```
Then a **manual dev smoke** (Claude, AI off): with an imported thesis, `/practice` shows the kind selector + "Generate a question" → clicking it with AI off shows the friendly "AI is disabled…" message (graceful degrade). Then inject a `practice_run` (question + answer + scores JSON incl. one ≤2 + diagnosis + follow_ups) and a matching `review_item`; reload `/practice` → the question, answer, 5-dim score grid (the ≤2 one red), diagnosis, rewrite, follow-ups render; `/review` → the low-score item with its question. Confirm `/practice` and `/review` with **no active thesis** show the import prompt.

Expected: gate green; test count = previous (141) + Task 1 (3) = 144 + 2 skipped. Typed casts in tests, never `as any`.

## Red-line / safety checklist

1. **Judge grounded only in bound evidence (red line #1):** the action calls `runJudge` (M3b) unchanged — it feeds the judge ONLY the run's bound evidence + the typed answer; the UI never passes thesis text to the model. Scores are a judgment, displayed read-only.
2. **Graceful degrade (red line #4):** both actions guard `effectiveAiEnabled && gatewayConfigured` → friendly message, no model call; `/practice` + `/review` render fully with AI off (you just can't generate/score).
3. **AI only via `lib/llm` (red line #2):** `runExaminerQuestion`/`runJudge` via `appLlmClient`; no provider SDK/model name in the actions.
4. **Answer binds to the shown question:** `submitAnswerAction` reads the form's `practiceRunId` but cross-checks `WHERE id=? AND thesis_id=?` (active thesis) before saving/judging — so the answer is scored against the exact question shown, and a tampered or cross-thesis id is rejected.
5. **Client/server boundary:** the `"use client"` forms import only the server-action references + react — no db/config/server-only module in the client bundle.

## Self-review

- **Spec coverage:** §7 ⑤ practice (AI examiner question via retrieval → typed answer → 5-dim judge + diagnosis + rewrite + follow-ups) → Tasks 2–3; §7 ⑥ review (≤2 queue) → Tasks 1,4. by_section/followup kinds, STT answers, and "mark fixed" are deferred (scope note).
- **Type consistency:** `PracticeRunView.scores` is `Record<string,number>|null` (parsed JSON; avoids a db→lib/llm import of `JudgeScores`); the page indexes it by the five `DIMS`. `PracticeState` shared by both forms + actions. `runExaminerQuestion(db,client,thesisId,kind)` + `runJudge(db,client,runId)` match M3a/M3b.
- **Testable surface:** Task 1 (3 repository reads) unit-tested; Tasks 2–4 (actions/pages) are typecheck + build + manual smoke — the examiner/judge cores are M3a/M3b-unit-tested, the AI-off branch + render are smoke-verified.
- **No placeholders:** full code for every file.
- **Resolved in round 1:** (a) the answer form carries `practiceRunId` and `submitAnswerAction` cross-checks it against the active thesis before judging — fixes a generate-Q2-then-answer-Q1 misbind; (c) `getReviewItems` also filters `score <= 2` and scopes its JOIN to the same thesis. (b) still deferred: `/practice` shows only the latest run (a practice history list is a later increment). `noUncheckedIndexedAccess` on `run.scores[d]` confirmed typechecking (guarded with `!== undefined` / `?.`).
