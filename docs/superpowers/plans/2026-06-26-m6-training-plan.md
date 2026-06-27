# M6 — Training Plan (static template) Implementation Plan

> **For agentic workers:** This project runs the Claude↔Codex 老流程 (see `AGENTS.md`): **Codex implements** each task; **Claude runs tests + reviews + commits** per task and at a milestone gate. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The last v1 milestone (spec §13). Give the user a multi-day study cadence: a static **15-day default plan** (each day a phase + a few linked activities), surfaced as a "today's plan" card on the dashboard and a full `/plan` page. The current day derives from how long ago the thesis was imported. Per spec §13/P2-17 this is intentionally a **static/stub template first** — editable/regenerable, DB-persisted plans (the `plan`/`plan_day` tables) are a later refinement.

**Architecture:** Pure + read-only. `lib/plan.ts` holds the template (`defaultPlan`) and the day math (`currentDayNumber`, `planPhase`) — no DB, no AI. The dashboard and `/plan` page render it, computing "today" from `getActiveThesis().createdAt`. No new tables, no writes.

**Tech Stack:** TypeScript (pure helpers), Next 16 RSC, Tailwind v4, vitest. No DB writes, no model calls.

> **Scope notes:** "settings" (spec §14) is already covered — AI provider/model + STT + the privacy disclosure live on `/library` (M4d), env-driven. M6 adds only the training plan. **Deferred:** per-user plan editing + DB persistence (`plan`/`plan_day` exist from M0 for this); AI-tailored plans; a "mark day done" / streak. The static template is the same cadence for any thesis (generic viva prep), which is the v1 intent.

> **Revised after Codex design-review round 1** (CONDITIONAL GO → fixes integrated): **P1** every phase now keeps the spec's full daily structure (each day touches `/materials`, `/practice`, AND `/review`), with a `defaultPlan()` test asserting it. **P2** added the two missing day-math edges (future `createdAt`→1, invalid `nowISO`→1); reworded the red-line checklist (the bridge's bootstrap migration isn't an M6 write). Codex confirmed the `createdAt`-derived current day + the deferral of plan-table persistence are honest for v1.

---

## Contracts

```ts
// src/lib/plan.ts — pure
export type PlanActivity = { label: string; href: string };
export type PlanDay = { day: number; phase: string; title: string; activities: PlanActivity[] };
export function planPhase(day: number): { name: string; activities: PlanActivity[] };
export function defaultPlan(totalDays?: number): PlanDay[];           // default 15
export function currentDayNumber(startedAtISO: string, totalDays: number, nowISO?: string): number;
export const TOTAL_DAYS = 15;
```

## File structure

- **Create** `src/lib/plan.ts` (+`src/lib/plan.test.ts`) — the template + day math.
- **Create** `src/app/plan/page.tsx` — the full plan view.
- **Modify** `src/app/page.tsx` — add the "today's plan" card.
- **Modify** `src/app/layout.tsx` — add the Plan nav link.

---

### Task 1: `lib/plan` — template + day math (pure)

**Files:** Create `src/lib/plan.ts`, `src/lib/plan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/plan.test.ts
import { describe, it, expect } from "vitest";
import { defaultPlan, planPhase, currentDayNumber, TOTAL_DAYS } from "./plan";

describe("planPhase", () => {
  it("maps day ranges to the three phases", () => {
    expect(planPhase(1).name).toBe("Build familiarity");
    expect(planPhase(5).name).toBe("Build familiarity");
    expect(planPhase(6).name).toBe("Drill the core");
    expect(planPhase(10).name).toBe("Drill the core");
    expect(planPhase(11).name).toBe("Polish under pressure");
    expect(planPhase(15).name).toBe("Polish under pressure");
    expect(planPhase(99).name).toBe("Polish under pressure"); // clamps past the end
    expect(planPhase(3).activities.length).toBeGreaterThan(0);
  });
});

describe("defaultPlan", () => {
  it("produces TOTAL_DAYS numbered days, each with a phase + activities", () => {
    const days = defaultPlan();
    expect(days).toHaveLength(TOTAL_DAYS);
    expect(days[0]).toMatchObject({ day: 1, phase: "Build familiarity", title: "Day 1" });
    expect(days[14]).toMatchObject({ day: 15, phase: "Polish under pressure" });
    expect(days.every((d) => d.activities.length > 0)).toBe(true);
    // every day keeps the spec's daily structure: materials + practice + review
    expect(days.every((d) => {
      const hrefs = d.activities.map((a) => a.href);
      return hrefs.includes("/materials") && hrefs.includes("/practice") && hrefs.includes("/review");
    })).toBe(true);
  });
});

describe("currentDayNumber", () => {
  it("counts days since the start (1-based), clamped to [1, totalDays]", () => {
    expect(currentDayNumber("2026-06-26T10:00:00Z", 15, "2026-06-26T23:00:00Z")).toBe(1); // same day
    expect(currentDayNumber("2026-06-26", 15, "2026-06-29")).toBe(4);                     // 3 days later
    expect(currentDayNumber("2026-06-01", 15, "2026-12-01")).toBe(15);                    // clamped to totalDays
    expect(currentDayNumber("2026-07-01", 15, "2026-06-29")).toBe(1);                     // future start → day 1
    expect(currentDayNumber("not-a-date", 15, "2026-06-29")).toBe(1);                     // bad start → day 1
    expect(currentDayNumber("2026-06-26", 15, "not-a-date")).toBe(1);                     // bad now → day 1
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/plan.test.ts` — FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/plan.ts
export type PlanActivity = { label: string; href: string };
export type PlanDay = { day: number; phase: string; title: string; activities: PlanActivity[] };

export const TOTAL_DAYS = 15;

// Every phase keeps the spec's daily structure — read materials -> core/AI training
// (practice) -> review — so each day touches /materials, /practice, AND /review.
const PHASES: { name: string; through: number; activities: PlanActivity[] }[] = [
  {
    name: "Build familiarity",
    through: 5,
    activities: [
      { label: "Read a section of your thesis materials", href: "/materials" },
      { label: "Answer 2 warm-up practice questions", href: "/practice" },
      { label: "Skim and triage your review queue", href: "/review" },
    ],
  },
  {
    name: "Drill the core",
    through: 10,
    activities: [
      { label: "Re-read a key section — focus on the numbers", href: "/materials" },
      { label: "Answer 3 practice questions (mix random & by-section)", href: "/practice" },
      { label: "Shore up your weak spots", href: "/review" },
    ],
  },
  {
    name: "Polish under pressure",
    through: 15,
    activities: [
      { label: "Re-read your verified key facts", href: "/materials" },
      { label: "Take a hostile or boundary question", href: "/practice" },
      { label: "Clear your review queue", href: "/review" },
    ],
  },
];

export function planPhase(day: number): { name: string; activities: PlanActivity[] } {
  const phase = PHASES.find((p) => day <= p.through) ?? PHASES[PHASES.length - 1]!;
  return { name: phase.name, activities: phase.activities };
}

export function defaultPlan(totalDays: number = TOTAL_DAYS): PlanDay[] {
  return Array.from({ length: totalDays }, (_, i) => {
    const day = i + 1;
    const { name, activities } = planPhase(day);
    return { day, phase: name, title: `Day ${day}`, activities };
  });
}

export function currentDayNumber(startedAtISO: string, totalDays: number, nowISO: string = new Date().toISOString()): number {
  const start = Date.parse(startedAtISO.slice(0, 10)); // date-only, ignore time-of-day
  const now = Date.parse(nowISO.slice(0, 10));
  if (Number.isNaN(start) || Number.isNaN(now)) return 1;
  const elapsedDays = Math.floor((now - start) / 86_400_000);
  return Math.min(Math.max(elapsedDays + 1, 1), totalDays);
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(m6): training-plan template + day math (Task 1)"`

---

### Task 2: `/plan` page + dashboard "today's plan" card + nav

**Files:** Create `src/app/plan/page.tsx`, Modify `src/app/page.tsx`, `src/app/layout.tsx`

- [ ] **Step 1: Add the nav link** — in `src/app/layout.tsx`, insert `{ href: "/plan", label: "Plan" }` into `NAV` right after the Today entry.

- [ ] **Step 2: Implement the plan page**

```tsx
// src/app/plan/page.tsx
import Link from "next/link";
import { appContext } from "../../lib/server/context";
import { getActiveThesis } from "../../db/repository";
import { defaultPlan, currentDayNumber, TOTAL_DAYS } from "../../lib/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const { db } = await appContext();
  const thesis = getActiveThesis(db);
  if (!thesis) {
    return (
      <section className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold">Training plan</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Import a thesis to start your plan.</p>
        <Link href="/import" className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">Import a thesis</Link>
      </section>
    );
  }

  const today = currentDayNumber(thesis.createdAt, TOTAL_DAYS);
  const days = defaultPlan();

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Training plan</h1>
        <p className="text-zinc-600 dark:text-zinc-400">A {TOTAL_DAYS}-day cadence for “{thesis.title}”. You’re on day {today}.</p>
      </div>

      <ol className="flex flex-col gap-3">
        {days.map((d) => {
          const isToday = d.day === today;
          return (
            <li key={d.day} className={`rounded-lg border p-4 ${isToday ? "border-zinc-900 bg-white dark:border-zinc-100 dark:bg-zinc-900" : "border-zinc-200 dark:border-zinc-800"}`}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-medium">{d.title} · {d.phase}</h2>
                {isToday ? <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Today</span> : null}
              </div>
              <ul className="mt-2 list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                {d.activities.map((a) => (
                  <li key={a.label}><Link href={a.href} className="underline-offset-2 hover:underline">{a.label}</Link></li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
```

- [ ] **Step 3: Add the dashboard "today's plan" card** — in `src/app/page.tsx`, import the plan helpers and render a card in the active-thesis branch (after the recommended-action `<Link>`, before the stats grid):

```tsx
// add to the imports:
import { currentDayNumber, planPhase, TOTAL_DAYS } from "../lib/plan";

// inside Home(), after `const next = recommendNextAction(stats, aiReady);`:
const today = currentDayNumber(thesis.createdAt, TOTAL_DAYS);
const phase = planPhase(today);

// in the JSX, after the recommended-next <Link> ... </Link>:
<div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
  <div className="flex items-baseline justify-between gap-3">
    <span className="text-sm font-medium">Day {today} of {TOTAL_DAYS} · {phase.name}</span>
    <Link href="/plan" className="text-sm text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400">Full plan →</Link>
  </div>
  <ul className="mt-2 list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
    {phase.activities.map((a) => (
      <li key={a.label}><Link href={a.href} className="underline-offset-2 hover:underline">{a.label}</Link></li>
    ))}
  </ul>
</div>
```

- [ ] **Step 4: Typecheck + build** — `npx tsc --noEmit` (exit 0). (Claude runs `npm run build`.)
- [ ] **Step 5: Commit** — `git commit -m "feat(m6): /plan page + today's-plan dashboard card + nav (Task 2)"`

---

## Full-suite gate + manual smoke (Claude runs)

```bash
npm run check   # typecheck + lint + vitest (incl. plan template/day-math tests)
npm run build   # Next prod build green (/plan + / Dynamic)
```
Then a **dev smoke** (Claude, AI off): with no thesis, `/plan` shows the import prompt and `/` has no plan card. Import a thesis → `/` shows a "Day 1 of 15 · Build familiarity" card with its activities + a Full-plan link; `/plan` lists 15 days with Day 1 marked **Today** and links to /materials, /practice, /review.

Expected: gate green; test count = previous (165) + Task 1 (3) = 168 + 2 skipped. Typed casts in tests, never `as any`.

## Red-line / safety checklist

1. **No AI, no M6 data mutations, local-first:** M6 is pure template rendering — no model calls, no provider data sent, no plan-table or content writes. (The bridge's `getDb` runs idempotent migrations on first open — existing bootstrap, not an M6 write.) Nothing leaves the machine.
2. **No client components:** `/plan` and the dashboard card are server-rendered (`runtime="nodejs"` + `dynamic="force-dynamic"`); no `"use client"`, no secret-leak surface.
3. **Read-only over the active thesis:** the plan reads only `getActiveThesis().createdAt`; it never touches prep/practice/review data or alters status — consistent with the validator-gated content model.
4. **Honest stub:** the plan is a fixed generic cadence; it is not presented as AI-personalised. Editable/persisted plans are explicitly deferred (scope note).

## Self-review

- **Spec coverage:** §13 training plan (multi-day cadence, the "read materials → core training → AI training → review" daily structure, default ~15 days, surfaced on Today) → Tasks 1–2 as a static template; §14 settings already shipped on `/library` (M4d). Editable/regenerate, AI-tailored, streak/mastery are deferred (P2-17, scope note).
- **Type consistency:** `currentDayNumber` takes an injectable `nowISO` (pure + testable); the dashboard + `/plan` both compute "today" from `thesis.createdAt` with the same `TOTAL_DAYS`; `planPhase`/`defaultPlan` share `PHASES`.
- **Testable surface:** Task 1 (template + day math) fully unit-tested; Task 2 (pages) is typecheck + build + dev smoke (pure RSC reads, no actions).
- **No placeholders:** full code for every file.
- **Resolved in round 1:** deriving "current day" from `thesis.createdAt` (calendar days since import) is the v1 choice — Codex confirmed it's acceptable and the deferral of `plan`/`plan_day` persistence (no `current_day` column; editable plans later) is honest given spec §13/P2-17. Every plan day covers the materials→practice→review daily structure.
