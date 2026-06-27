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
