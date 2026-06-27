export type PlanActivity = { label: string; href: string };
export type PlanDay = { day: number; phase: string; title: string; activities: PlanActivity[] };
export type StaticPlanDay = { dayNo: number; title: string; focus: string; activities: string[] };

export const TOTAL_DAYS = 15;
export const MIN_PLAN_DAYS = 3;
export const MAX_PLAN_DAYS = 30;

// Every phase keeps the spec's daily structure — read materials -> core/AI training
// (practice) -> review — so each day touches /materials, /practice, AND /review.
const PHASES: { name: string; activities: PlanActivity[] }[] = [
  {
    name: "Build familiarity",
    activities: [
      { label: "Read a section of your thesis materials", href: "/materials" },
      { label: "Answer 2 warm-up practice questions", href: "/practice" },
      { label: "Skim and triage your review queue", href: "/review" },
    ],
  },
  {
    name: "Drill the core",
    activities: [
      { label: "Re-read a key section — focus on the numbers", href: "/materials" },
      { label: "Answer 3 practice questions (mix random & by-section)", href: "/practice" },
      { label: "Shore up your weak spots", href: "/review" },
    ],
  },
  {
    name: "Polish under pressure",
    activities: [
      { label: "Re-read your verified key facts", href: "/materials" },
      { label: "Take a hostile or boundary question", href: "/practice" },
      { label: "Clear your review queue", href: "/review" },
    ],
  },
];

export function planPhase(day: number, totalDays: number = TOTAL_DAYS): { name: string; activities: PlanActivity[] } {
  const rawPhase = Math.floor(((day - 1) / Math.max(totalDays, 1)) * PHASES.length);
  const phaseIndex = Math.min(Math.max(rawPhase, 0), PHASES.length - 1);
  const phase = PHASES[phaseIndex]!;
  return { name: phase.name, activities: phase.activities };
}

export function defaultPlan(totalDays: number = TOTAL_DAYS): PlanDay[] {
  const days = Math.max(0, Math.floor(totalDays));
  return Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    const { name, activities } = planPhase(day, days);
    return { day, phase: name, title: `Day ${day}`, activities };
  });
}

export function clampPlanDays(n: number): number {
  const rounded = Math.round(n) || TOTAL_DAYS;
  return Math.min(Math.max(rounded, MIN_PLAN_DAYS), MAX_PLAN_DAYS);
}

export function staticPlanDays(totalDays: number): StaticPlanDay[] {
  return defaultPlan(totalDays).map((d) => ({
    dayNo: d.day,
    title: d.title,
    focus: d.phase,
    activities: d.activities.map((a) => a.label),
  }));
}

export function currentDayNumber(startedAtISO: string, totalDays: number, nowISO: string = new Date().toISOString()): number {
  const start = Date.parse(startedAtISO.slice(0, 10)); // date-only, ignore time-of-day
  const now = Date.parse(nowISO.slice(0, 10));
  if (Number.isNaN(start) || Number.isNaN(now)) return 1;
  const elapsedDays = Math.floor((now - start) / 86_400_000);
  return Math.min(Math.max(elapsedDays + 1, 1), totalDays);
}
