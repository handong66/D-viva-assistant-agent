import Link from "next/link";
import { generatePlanAction } from "../_actions/plan";
import { appContext } from "../../lib/server/context";
import { getActivePlan, getActiveThesis, type SavedPlan } from "../../db/repository";
import { currentDayNumber, MAX_PLAN_DAYS, MIN_PLAN_DAYS, TOTAL_DAYS } from "../../lib/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const { db, config } = await appContext();
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

  const plan = getActivePlan(db, thesis.id);
  const aiReady = config.effectiveAiEnabled && config.gatewayConfigured;

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Training plan</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Build a local study schedule for “{thesis.title}”.</p>
      </div>

      <PlanForm defaultDays={plan?.totalDays ?? TOTAL_DAYS} aiReady={aiReady} />

      {plan ? <SavedPlanView plan={plan} /> : <EmptyPlanState />}
    </section>
  );
}

function PlanForm({ defaultDays, aiReady }: { defaultDays: number; aiReady: boolean }) {
  return (
    <form action={generatePlanAction} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Days</span>
          <input
            name="days"
            type="number"
            min={MIN_PLAN_DAYS}
            max={MAX_PLAN_DAYS}
            defaultValue={defaultDays}
            className="w-32 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <button type="submit" className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">
          Generate plan
        </button>
      </div>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        {aiReady
          ? "AI is on - generating sends your thesis title, section names, and a short progress summary to your configured AI provider."
          : "AI is off - you will get a standard N-day template. Nothing is sent."}
      </p>
    </form>
  );
}

function SavedPlanView({ plan }: { plan: SavedPlan }) {
  const today = currentDayNumber(plan.createdAt, plan.totalDays);
  const templateLabel = plan.templateKey === "ai" ? "AI" : "Static";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{plan.name} · day {today} of {plan.totalDays}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This is a study schedule - double-check any specifics against your materials and prep pack.
          </p>
        </div>
        <span className="w-fit rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-medium dark:border-zinc-700">
          {templateLabel}
        </span>
      </div>

      <ol className="flex flex-col gap-3">
        {plan.days.map((day) => {
          const isToday = day.dayNo === today;
          return (
            <li
              key={day.dayNo}
              className={`rounded-lg border p-4 ${isToday ? "border-zinc-900 bg-white dark:border-zinc-100 dark:bg-zinc-900" : "border-zinc-200 dark:border-zinc-800"}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-medium">{day.title}</h3>
                {isToday ? <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Today</span> : null}
              </div>
              <p className="mt-1 text-sm text-zinc-500">{day.focus}</p>
              <ul className="mt-2 list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                {day.activities.map((activity) => <li key={activity}>{activity}</li>)}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function EmptyPlanState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 p-6 dark:border-zinc-700">
      <h2 className="font-medium">No training plan yet</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Choose a length and generate a plan to anchor your daily prep.
      </p>
    </div>
  );
}
