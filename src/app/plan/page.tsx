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
