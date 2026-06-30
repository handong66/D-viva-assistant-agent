import Link from "next/link";
import { generatePlanAction } from "../_actions/plan";
import { appContext } from "../../lib/server/context";
import { getActivePlan, getActiveThesis, type SavedPlan } from "../../db/repository";
import { currentDayNumber, MAX_PLAN_DAYS, MIN_PLAN_DAYS, TOTAL_DAYS } from "../../lib/plan";
import { getUiCopy, type UiLocale } from "../../lib/ui-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const { db, config } = await appContext();
  const t = getUiCopy(config.uiLocale);
  const thesis = getActiveThesis(db);
  if (!thesis) {
    return (
      <section className="panel panel-pad flex max-w-2xl flex-col items-start gap-4">
        <h1 className="page-title">{t.plan.title}</h1>
        <p className="muted">{t.plan.importBody}</p>
        <Link href="/import" className="btn-primary">{t.common.importThesis}</Link>
      </section>
    );
  }

  const plan = getActivePlan(db, thesis.id);
  const aiReady = config.effectiveAiEnabled && config.gatewayConfigured;

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">{t.plan.title}</h1>
        <p className="mt-2 text-sm muted">{t.plan.buildFor(thesis.title)}</p>
      </div>

      <PlanForm defaultDays={plan?.totalDays ?? TOTAL_DAYS} aiReady={aiReady} locale={config.uiLocale} />

      {plan ? <SavedPlanView plan={plan} locale={config.uiLocale} /> : <EmptyPlanState locale={config.uiLocale} />}
    </section>
  );
}

function PlanForm({ defaultDays, aiReady, locale }: { defaultDays: number; aiReady: boolean; locale: UiLocale }) {
  const t = getUiCopy(locale).plan;
  return (
    <form action={generatePlanAction} className="panel panel-pad">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t.days}</span>
          <input
            name="days"
            type="number"
            min={MIN_PLAN_DAYS}
            max={MAX_PLAN_DAYS}
            defaultValue={defaultDays}
            className="field w-32"
          />
        </label>
        <button type="submit" className="btn-primary">
          {t.generate}
        </button>
      </div>
      <p className="mt-3 text-sm muted">
        {aiReady
          ? t.aiOn
          : t.aiOff}
      </p>
    </form>
  );
}

function SavedPlanView({ plan, locale }: { plan: SavedPlan; locale: UiLocale }) {
  const t = getUiCopy(locale).plan;
  const today = currentDayNumber(plan.createdAt, plan.totalDays);
  const templateLabel = plan.templateKey === "ai" ? t.ai : t.static;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t.daySummary(plan.name, today, plan.totalDays)}</h2>
          <p className="text-sm muted">
            {t.doubleCheck}
          </p>
        </div>
        <span className="badge badge-zinc w-fit">
          {templateLabel}
        </span>
      </div>

      <ol className="panel divide-y divide-[#e4ebe8]">
        {plan.days.map((day) => {
          const isToday = day.dayNo === today;
          return (
            <li
              key={day.dayNo}
              className={`grid gap-3 px-5 py-4 sm:grid-cols-[88px_1fr_auto] sm:items-start ${isToday ? "bg-[#f7fbf9]" : ""}`}
            >
              <div className="text-sm font-semibold tabular-nums text-[#006b5b]">
                {String(day.dayNo).padStart(2, "0")}
              </div>
              <div>
                <h3 className="font-semibold">{day.title}</h3>
                <p className="mt-1 text-sm muted">{day.focus}</p>
                <ul className="mt-3 grid gap-1 text-sm muted sm:grid-cols-3">
                  {day.activities.map((activity) => <li key={activity}>- {activity}</li>)}
                </ul>
              </div>
              {isToday ? <span className="badge badge-green w-fit">{t.today}</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function EmptyPlanState({ locale }: { locale: UiLocale }) {
  const t = getUiCopy(locale).plan;
  return (
    <div className="panel panel-pad border-dashed">
      <h2 className="font-medium">{t.noPlan}</h2>
      <p className="mt-1 text-sm muted">
        {t.noPlanBody}
      </p>
    </div>
  );
}
