# Feature 1 — AI-generated, user-set-length training plan

> **老流程:** Codex implements per task; Claude runs the gate + reviews + commits, with a Codex design review before code and a milestone gate after. (New feature: LLM + DB + UI — milestone gate. **Revised after design rounds 1-2.**)

**Goal:** Replace the static 15-day template with a plan the user controls: the user enters how many days they have (e.g. 5 or 10); if AI is available it **generates an N-day plan tailored to the thesis** (its sections + the user's progress); the plan is **persisted** and rendered on `/plan` + the dashboard, with the current day counting from when the plan was created. AI off (or any failure) → a static N-day template (red line #4).

**Architecture:** A training-plan generator through the unified LLM layer (`lib/llm/training-plan*`), mirroring `prep-pack`. Persistence uses the existing `plan`/`plan_day` tables (+ a `plan.created_at` column via **migration 0003** — `0002` is the existing FTS migration). `lib/plan.ts`'s phase logic is **reworked to scale by fraction of N** (it currently hardcodes day-5/10/15 thresholds — a real bug: a 5-day plan never leaves phase 1). A Server Action generates+saves; `/plan` + the dashboard read the active plan (or the static default when none exists).

> **Red-line handling (rounds 1-2). The plan is fabrication-PROOF by construction, not by filtering free text:**
> - The AI returns ONLY **structured** choices per day: a short word-only `theme`, `sectionFocus` (section names, validated ⊆ the real sections we pass — invented ones dropped), and `actions` from a fixed enum (`read/practice/review/rehearse/summarize`). All displayed activity TEXT is rendered from **fixed templates + real section names** — the model never emits free-form prose, numbers, statistics, or quotes. The only free text (`theme`) is validated to be words-only (no digits/quotes/`%`); a violation → static fallback. So no per-item evidence binding is needed and no thesis fact can be fabricated (red line #1).
> - **Outbound disclosure (#3):** the generate form states exactly what is sent to the provider when AI is on (thesis title, section names, a short progress summary).
> - Generation goes through `client.generateObject` (#2); no key / AI failure / safety violation → static `defaultPlan(N)` (#4). Mock-tested; no real model in tests.

**Tech Stack:** zod (AI SDK), better-sqlite3 (migration + plan tables), Next 16 RSC + Server Action, Tailwind, vitest (mock LLM).

---

### Task 1: scale `lib/plan.ts` by fraction + migration 0003 + persistence

**Files:** Modify `src/lib/plan.ts` (+`src/lib/plan.test.ts`, and the `planPhase` callers `src/app/plan/page.tsx` + `src/app/page.tsx`); Create `src/db/migrations/0003_plan_created_at.ts`; Modify `src/db/migrations/index.ts`, `src/db/repository.ts` (+`src/db/repository.plan.test.ts`)

- [ ] **Step 1a (P1-3): phases scale by fraction of N.** Rework `planPhase` to take `totalDays` and pick by `day/totalDays` thirds, so `defaultPlan(5)` reaches all three phases:
```ts
export function planPhase(day: number, totalDays: number = TOTAL_DAYS): { name: string; activities: PlanActivity[] } {
  const frac = day / Math.max(totalDays, 1);
  const phase = frac <= 1 / 3 ? PHASES[0]! : frac <= 2 / 3 ? PHASES[1]! : PHASES[2]!;
  return { name: phase.name, activities: phase.activities };
}
export function defaultPlan(totalDays: number = TOTAL_DAYS): PlanDay[] {
  return Array.from({ length: totalDays }, (_, i) => { const day = i + 1; const { name, activities } = planPhase(day, totalDays); return { day, phase: name, title: `Day ${day}`, activities }; });
}
export const MIN_PLAN_DAYS = 3; export const MAX_PLAN_DAYS = 30;
export function clampPlanDays(n: number): number { return Math.min(Math.max(Math.round(n) || TOTAL_DAYS, MIN_PLAN_DAYS), MAX_PLAN_DAYS); }
export function staticPlanDays(totalDays: number) { return defaultPlan(totalDays).map((d) => ({ dayNo: d.day, title: d.title, focus: d.phase, activities: d.activities.map((a) => a.label) })); }
```
  Update `lib/plan.test.ts` (M6) cases that call `planPhase(day)` to pass `totalDays`, and add cases asserting all 3 phases appear for N = 3, 5, 10, 30. Update the two callers to pass `totalDays` (Task 3 rewires them fully).

- [ ] **Step 1b: Migration 0003** (`0002` is FTS). Nullable column, backfilled once, set explicitly on insert:
```ts
// src/db/migrations/0003_plan_created_at.ts — SAME `export const sql` shape as 0001/0002
export const sql = `
ALTER TABLE plan ADD COLUMN created_at TEXT;
UPDATE plan SET created_at = datetime('now') WHERE created_at IS NULL;`;
```
Register in `src/db/migrations/index.ts`: `import { sql as m0003 } from "./0003_plan_created_at";` + append `{ version: 3, sql: m0003 }`.

- [ ] **Step 1c: persistence + sections reader** (`src/db/repository.ts`) + tests in `src/db/repository.plan.test.ts` (round-trip; second save REPLACES; sections distinct in document order):
```ts
export type PlanDayInput = { dayNo: number; title: string; focus: string; activities: string[] };
export type SavedPlan = { id: string; name: string; totalDays: number; templateKey: string; createdAt: string; days: { dayNo: number; title: string; focus: string | null; activities: string[] }[] };

export function getThesisSections(db: DB, thesisId: string): string[] {
  return (db.prepare("SELECT section, min(ord) AS first_ord FROM thesis_chunk WHERE thesis_id = ? AND section IS NOT NULL AND trim(section) <> '' GROUP BY section ORDER BY first_ord").all(thesisId) as { section: string }[]).map((r) => r.section);
}
export function savePlan(db: DB, input: { thesisId: string; name: string; totalDays: number; templateKey: string; days: PlanDayInput[] }): string {
  const planId = randomUUID();
  db.transaction(() => {
    db.prepare("DELETE FROM plan WHERE thesis_id = ?").run(input.thesisId);
    db.prepare("INSERT INTO plan (id, thesis_id, name, total_days, template_key, created_at) VALUES (?,?,?,?,?,datetime('now'))").run(planId, input.thesisId, input.name, input.totalDays, input.templateKey);
    const ins = db.prepare("INSERT INTO plan_day (id, plan_id, day_no, title, focus, blocks) VALUES (?,?,?,?,?,?)");
    for (const d of input.days) ins.run(randomUUID(), planId, d.dayNo, d.title, d.focus, JSON.stringify(d.activities));
  })();
  return planId;
}
export function getActivePlan(db: DB, thesisId: string): SavedPlan | undefined {
  const p = db.prepare("SELECT id, name, total_days, template_key, created_at FROM plan WHERE thesis_id = ? ORDER BY rowid DESC LIMIT 1").get(thesisId) as { id: string; name: string; total_days: number; template_key: string; created_at: string | null } | undefined;
  if (!p) return undefined;
  const days = (db.prepare("SELECT day_no, title, focus, blocks FROM plan_day WHERE plan_id = ? ORDER BY day_no").all(p.id) as { day_no: number; title: string; focus: string | null; blocks: string | null }[]).map((d) => ({ dayNo: d.day_no, title: d.title, focus: d.focus, activities: safeJsonArray(d.blocks) }));
  return { id: p.id, name: p.name, totalDays: p.total_days, templateKey: p.template_key, createdAt: p.created_at ?? new Date().toISOString(), days };
}
// helper safeJsonArray(s: string | null): string[] — try/catch JSON.parse, return [] unless an array of strings
```

- [ ] **Step 2: PASS**, commit — `git commit -m "feat(f1): fraction-scaled plan phases + plan persistence + created_at migration (0003)"`

---

### Task 2: STRUCTURED training-plan generation (fabrication-proof)

**Files:** Create `src/lib/llm/training-plan.ts`, `src/lib/llm/training-plan-run.ts` (+`src/lib/llm/training-plan-run.test.ts`)

- [ ] **Step 1: Structured schema + prompt + fixed-template renderer** (`src/lib/llm/training-plan.ts`):
```ts
import { z } from "zod";
import type { LlmClient } from "./types";

export const PLAN_ACTIONS = ["read", "practice", "review", "rehearse", "summarize"] as const;
const PlanDayGenSchema = z.object({
  theme: z.string().min(1).max(60),                 // short label, e.g. "Foundations" — words only (validated)
  sectionFocus: z.array(z.string()).max(4),         // section names; filtered to the REAL sections in renderPlanDay
  actions: z.array(z.enum(PLAN_ACTIONS)).min(1).max(4),
});
export const TrainingPlanSchema = z.object({ days: z.array(PlanDayGenSchema).min(1) });
export type GeneratedPlanDay = z.infer<typeof PlanDayGenSchema>;

export function buildTrainingPlanPrompt(args: { title: string; sections: string[]; totalDays: number; progress: string }): string {
  return [
    `You are a viva (thesis defence) coach building a ${args.totalDays}-day prep SCHEDULE for the thesis "${args.title}".`,
    `Return EXACTLY ${args.totalDays} days. For each day output ONLY: "theme" (a few WORDS, no numbers/quotes/findings), "sectionFocus" (0-4 section names chosen FROM the list below), and "actions" (1-4 of: ${PLAN_ACTIONS.join(", ")}).`,
    `Sequence an arc across days: early = read/understand, middle = practice, late = rehearse + review weak spots. Pick which sections to emphasise each day from the candidate's progress.`,
    `You are scheduling study TIME with fixed action types — you are NOT writing prose, stating findings, citing numbers, or quoting the thesis.`,
    ``,
    `THESIS SECTIONS (choose sectionFocus only from these): ${args.sections.length ? args.sections.join("; ") : "(none — leave sectionFocus empty)"}`,
    `CANDIDATE PROGRESS: ${args.progress}`,
  ].join("\n");
}

export async function generateTrainingPlan(client: LlmClient, args: { thesisId: string; title: string; sections: string[]; totalDays: number; progress: string }): Promise<GeneratedPlanDay[]> {
  const out = await client.generateObject({ role: "default", purpose: "training_plan", schema: TrainingPlanSchema, prompt: buildTrainingPlanPrompt(args), thesisId: args.thesisId });
  return out.days;
}

// All activity TEXT comes from these fixed templates + REAL section names — never the model's free text.
const ACTION_LABEL: Record<(typeof PLAN_ACTIONS)[number], (secs: string) => string> = {
  read: (s) => (s ? `Read & annotate: ${s}` : "Read your core material"),
  practice: (s) => (s ? `Practice viva questions on ${s}` : "Practice viva questions"),
  review: () => "Review your weak spots & flagged review items",
  rehearse: () => "Rehearse your answers out loud",
  summarize: (s) => (s ? `Write a one-page summary of ${s}` : "Summarise your key arguments"),
};
const THEME_BAD = /["“”«»%]|\d/; // a theme is words only
/** Render a structured day → stored shape, or null if the theme smuggled a fact (caller → static fallback). */
export function renderPlanDay(gen: GeneratedPlanDay, dayNo: number, validSections: Set<string>): { dayNo: number; title: string; focus: string; activities: string[] } | null {
  if (THEME_BAD.test(gen.theme)) return null;
  const secs = gen.sectionFocus.filter((s) => validSections.has(s)); // drop invented sections
  const label = secs.join(", ");
  const activities = gen.actions.map((a) => ACTION_LABEL[a](label));
  return { dayNo, title: `Day ${dayNo} — ${gen.theme}`, focus: secs.length ? `Focus: ${secs.join(", ")}` : "General review", activities };
}
```

- [ ] **Step 2: Run** (`src/lib/llm/training-plan-run.ts`) — generate → render+validate every day → normalize to EXACTLY N → persist; any theme violation → static fallback:
```ts
import "server-only";
import type { Database as DB } from "better-sqlite3";
import type { LlmClient } from "./types";
import { generateTrainingPlan, renderPlanDay } from "./training-plan";
import { getThesisSections, getThesisStats, getReviewItems, savePlan, type PlanDayInput } from "../../db/repository";
import { staticPlanDays } from "../plan";

export async function runTrainingPlanGeneration(db: DB, client: LlmClient, thesisId: string, totalDays: number): Promise<{ source: "ai" | "static" }> {
  const thesis = db.prepare("SELECT title FROM thesis WHERE id=?").get(thesisId) as { title: string };
  const sections = getThesisSections(db, thesisId);
  const stats = getThesisStats(db, thesisId);
  const weak = Array.from(new Set(getReviewItems(db, thesisId).map((r) => r.dimension)));
  const progress = `${stats.prepVerified} verified prep items, ${stats.prepNeedsReview} need review, ${stats.openReviews} open review spots${weak.length ? `; weakest dimensions: ${weak.join(", ")}` : ""}.`;
  const validSections = new Set(sections);
  const generated = await generateTrainingPlan(client, { thesisId, title: thesis.title, sections, totalDays, progress });
  const rendered = generated.map((g, i) => renderPlanDay(g, i + 1, validSections));
  const saveStatic = () => { savePlan(db, { thesisId, name: `${totalDays}-day plan`, totalDays, templateKey: "static", days: staticPlanDays(totalDays) }); };
  if (rendered.some((d) => d === null)) { saveStatic(); return { source: "static" }; } // theme smuggled a fact
  const days: PlanDayInput[] = normalizeToNDays(rendered as NonNullable<(typeof rendered)[number]>[], totalDays); // truncate; pad with a fixed review+rehearse day, renumbered dayNo 1..N
  savePlan(db, { thesisId, name: `${totalDays}-day plan`, totalDays, templateKey: "ai", days });
  return { source: "ai" };
}
// normalizeToNDays(days, N): slice(0,N), then while length<N push { dayNo:len+1, title:`Day ${len+1} — Review & rehearse`, focus:"General review", activities:["Review your weak spots & flagged review items","Rehearse your answers out loud"] }; finally re-number dayNo = index+1
```

- [ ] **Step 3: Tests** (mock client): a clean structured output → saved `templateKey='ai'`, exactly N days, activities are the FIXED-template strings (e.g. "Practice viva questions on …"); an **invented sectionFocus is dropped** from the rendered activity; a **theme containing a digit/quote/`%` → static fallback** (`templateKey='static'`); too-short padded / too-long truncated to N.

- [ ] **Step 4: PASS + typecheck**, commit — `git commit -m "feat(f1): structured fabrication-proof AI training-plan generation (N-day normalized)"`

---

### Task 3: action + `/plan` form/render (+ disclosure) + dashboard wiring

**Files:** Create `src/app/_actions/plan.ts`; Modify `src/app/plan/page.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Action** (`src/app/_actions/plan.ts`) — explicit awaits, AI-failure → static (matches `prep.ts`'s `await appContext()`/`appLlmClient()` shape):
```ts
export async function generatePlanAction(formData: FormData): Promise<void> {
  const { db, config } = await appContext();
  const thesis = getActiveThesis(db);
  if (!thesis) redirect("/import");
  const days = clampPlanDays(Number(formData.get("days")));
  if (config.effectiveAiEnabled && config.gatewayConfigured) {
    try { const client = await appLlmClient({ db, config }); await runTrainingPlanGeneration(db, client, thesis.id, days); }
    catch (e) { console.error("[generatePlanAction]", e); savePlan(db, { thesisId: thesis.id, name: `${days}-day plan`, totalDays: days, templateKey: "static", days: staticPlanDays(days) }); }
  } else {
    savePlan(db, { thesisId: thesis.id, name: `${days}-day plan`, totalDays: days, templateKey: "static", days: staticPlanDays(days) });
  }
  revalidatePath("/plan"); revalidatePath("/");
  redirect("/plan"); // OUTSIDE the try
}
```

- [ ] **Step 2: `/plan` page** — read `getActivePlan(db, thesis.id)`:
  - **Form** (always; server-component `<form action={generatePlanAction}>`): `name="days"` number input (min 3 max 30 default 15) + "Generate plan". **Disclosure (P1-2):** AI on → "Generating sends your thesis title, section names, and a short progress summary to your configured AI provider."; AI off → "AI is off — you'll get a standard N-day template (nothing is sent)."
  - **Plan exists:** `today = currentDayNumber(plan.createdAt, plan.totalDays)`; render `plan.days` (each: title + focus + activity list; highlight today + "Today" badge); header "{name} · day {today} of {totalDays}" + a `{templateKey === 'ai' ? 'tailored by AI' : 'standard template'}` tag + the disclaimer "This is a study schedule — double-check any specifics against your materials and prep pack."
  - **None:** empty state + the form (+ optional static `defaultPlan(15)` preview).

- [ ] **Step 3: Dashboard card** (`src/app/page.tsx`) — active plan exists → use `plan.createdAt`/`plan.totalDays` for `currentDayNumber` + show that day's title + activities (link `/plan`); else the static `planPhase(today, TOTAL_DAYS)` fallback.

- [ ] **Step 4: Typecheck + build**, commit — `git commit -m "feat(f1): generate-plan action + /plan form/disclosure/render + dashboard wiring"`

---

## Gate + smoke (Claude)

```bash
npm run check   # fraction-phase tests, plan persistence, structured training-plan-run (incl. invented-section drop + theme-violation→static), existing suite
npm run build   # /plan + / Dynamic
```
Dev smoke (AI OFF): import a thesis → `/plan` empty state + form + "AI is off" disclosure → submit "5" → a persisted 5-day STATIC plan that reaches all 3 phases (day1 build, day3 drill, day5 polish), day 1 highlighted, dashboard "Day 1 of 5". Submit "10" → replaced. (AI structured path + safety are mock-tested.)

## Red lines

1. **Fabrication-proof by construction (#1):** the model emits only `theme`(words)+`sectionFocus`(⊆ real sections)+`actions`(enum); all activity text is fixed templates + real section names; a non-word theme → static. No fabricated number/quote/finding can render; no per-item evidence binding needed; prep/practice verdicts untouched.
2. **Unified LLM + degrade (#2/#4):** `client.generateObject` (purpose `training_plan`); no key / AI failure / safety violation → static `defaultPlan(N)`. Mock-tested.
3. **Local-first + disclosure (#3):** plan persists locally; the form states exactly what is sent to the provider.

## Self-review

- **Rounds 1-2 folded in:** P1-1 → **structured fabrication-proof generation** (round-2 fix; no free-text facts possible); P1-3 fraction-scaled phases (+ tests for 3/5/10/30, callers/M6 tests updated); P1-2 form disclosure; P1-4 `GROUP BY ... min(ord)`; P1-5 explicit awaits; P2 migration backfill + consistent 0003; registration at `src/db/migrations/index.ts`.
- **One active plan/thesis:** `savePlan` deletes prior (cascade) then inserts; day-1 anchor = `plan.created_at`.
- **Normalization:** the run forces EXACTLY N days (truncate/pad), so the UI + `currentDayNumber(totalDays)` agree.
- **Tailoring preserved:** the AI still sequences the user's REAL sections + chooses the action mix + arc per day — personalised, just not free-text.
