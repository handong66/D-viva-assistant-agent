import Link from "next/link";
import { appContext } from "../lib/server/context";
import { getActivePlan, getActiveThesis, getPrepItems, getReviewItems, getThesisStats } from "../db/repository";
import { recommendNextAction } from "../lib/dashboard";
import { currentDayNumber, planPhase, TOTAL_DAYS } from "../lib/plan";
import { getUiCopy, labelFromMap } from "../lib/ui-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const { db, config } = await appContext();
  const t = getUiCopy(config.uiLocale);
  const thesis = getActiveThesis(db);

  if (!thesis) {
    return (
      <section className="panel panel-pad flex max-w-2xl flex-col items-start gap-4">
        <h1 className="page-title">{t.common.noThesis}</h1>
        <p className="muted">{t.home.noThesisBody}</p>
        <Link href="/import" className="btn-primary">{t.common.importThesis}</Link>
      </section>
    );
  }

  const stats = getThesisStats(db, thesis.id);
  const reviews = getReviewItems(db, thesis.id, 3);
  const prepItems = getPrepItems(db, thesis.id);
  const aiReady = config.effectiveAiEnabled && config.gatewayConfigured;
  const next = recommendNextAction(stats, aiReady, config.uiLocale);
  const activePlan = getActivePlan(db, thesis.id);
  const planToday = activePlan ? currentDayNumber(activePlan.createdAt, activePlan.totalDays) : null;
  const activeDay = activePlan && planToday !== null
    ? activePlan.days.find((day) => day.dayNo === planToday) ?? activePlan.days[0] ?? null
    : null;
  const staticToday = currentDayNumber(thesis.createdAt, TOTAL_DAYS);
  const staticPhase = planPhase(staticToday, TOTAL_DAYS);
  const ui = dashboardLabels(config.uiLocale);
  const timeline = activePlan?.days.slice(0, 7) ?? [
    {
      dayNo: staticToday,
      title: staticPhase.name,
      focus: ui.localTemplate,
      activities: staticPhase.activities.map((a) => a.label),
    },
  ];

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="page-title">{thesis.title}</h1>
        <p className="mt-2 text-sm muted">
          {thesis.author ? `${thesis.author} · ` : ""}{thesis.sourceKind.toUpperCase()} · {thesis.createdAt.slice(0, 10)}
        </p>
      </div>

      <Link href={next.href} className="command-strip flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white/75">{t.home.recommendedNext}</p>
          <p className="mt-1 text-2xl font-semibold leading-tight">{next.label}</p>
          <p className="mt-2 text-sm text-white/72">{ui.estimate}</p>
        </div>
        <span className="btn-secondary border-white/30 bg-white text-[#004f43] hover:bg-white">{ui.viewDetails}</span>
      </Link>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.98fr]">
        <section className="panel">
          <div className="flex items-center justify-between border-b border-[#d9e3df] px-5 py-4">
            <h2 className="text-lg font-semibold">
              {activePlan && activeDay && planToday !== null
                ? `${ui.todayPlan} · ${t.home.dayOf(planToday, activePlan.totalDays)}`
                : `${ui.todayPlan} · ${t.home.dayOf(staticToday, TOTAL_DAYS)}`}
            </h2>
            <Link href="/plan" className="btn-ghost min-h-0 px-2 py-1 text-sm">{t.home.fullPlan}</Link>
          </div>
          <ol className="divide-y divide-[#e4ebe8] px-5">
            {timeline.map((day, index) => {
              const isToday = activePlan ? day.dayNo === (planToday ?? 1) : index === 0;
              return (
                <li key={`${day.dayNo}-${day.title}`} className="grid grid-cols-[72px_1fr_auto] items-center gap-4 py-3">
                  <span className="text-sm tabular-nums muted">{ui.timeSlots[index] ?? `${day.dayNo}:00`}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">{day.title}</p>
                      <span className={`badge ${isToday ? "badge-green" : "badge-zinc"}`}>{isToday ? ui.inProgress : ui.upNext}</span>
                    </div>
                    <p className="mt-1 truncate text-xs muted">{day.activities[0] ?? day.focus}</p>
                  </div>
                  <span className="text-sm muted">{isToday ? `1 / ${Math.max(day.activities.length, 1)}` : `0 / ${Math.max(day.activities.length, 1)}`}</span>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d9e3df] px-5 py-3 text-sm muted">
            <span>{ui.planDays}: {activePlan?.totalDays ?? TOTAL_DAYS}</span>
            <span>{activePlan?.templateKey === "ai" ? ui.aiPlan : ui.staticPlan}</span>
          </div>
        </section>

        <section className="panel panel-pad">
          <h2 className="text-lg font-semibold">{ui.overview}</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label={t.home.verified} value={stats.prepVerified} total={Math.max(stats.prepTotal, 1)} />
            <Metric label={t.home.needsReview} value={stats.prepNeedsReview} total={Math.max(stats.prepTotal, 1)} tone="amber" />
            <Metric label={t.home.practiceRuns} value={stats.practiceRuns} />
            <Metric label={t.home.toReview} value={stats.openReviews} tone="red" />
          </div>
          <div className="mt-5 flex flex-col gap-3">
            <ProgressRow label={ui.evidenceCoverage} value={stats.evidenceUnits} total={Math.max(stats.evidenceUnits, 12)} />
            <ProgressRow label={ui.prepReadiness} value={stats.prepVerified} total={Math.max(stats.prepTotal, 1)} />
            <ProgressRow label={ui.reviewClearance} value={Math.max(0, stats.practiceRuns - stats.openReviews)} total={Math.max(stats.practiceRuns, stats.openReviews, 1)} />
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.98fr]">
        <section className="panel">
          <div className="flex items-center justify-between border-b border-[#d9e3df] px-5 py-4">
            <h2 className="text-lg font-semibold">{ui.reviewQueue} ({stats.openReviews})</h2>
            <Link href="/review" className="btn-ghost min-h-0 px-2 py-1 text-sm">{ui.viewAll}</Link>
          </div>
          <div className="divide-y divide-[#e4ebe8] px-5">
            {reviews.length === 0 ? (
              <p className="py-5 text-sm muted">{t.review.empty}</p>
            ) : reviews.map((item) => (
              <div key={item.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{item.question}</p>
                  <p className="mt-1 truncate text-sm muted">{item.reason ?? ui.needsFollowup}</p>
                </div>
                <span className="badge badge-red self-start">{labelFromMap(t.labels.dimensions, item.dimension)} · {item.score}/5</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="flex items-center justify-between border-b border-[#d9e3df] px-5 py-4">
            <h2 className="text-lg font-semibold">{ui.materialStatus}</h2>
            <Link href="/materials" className="btn-ghost min-h-0 px-2 py-1 text-sm">{ui.openMaterials}</Link>
          </div>
          <div className="divide-y divide-[#e4ebe8] px-5">
            {prepItems.length === 0 ? (
              <p className="py-5 text-sm muted">{t.materials.empty}</p>
            ) : prepItems.slice(0, 5).map((item) => (
              <div key={item.id} className="grid grid-cols-[1fr_auto_92px] items-center gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{item.title}</p>
                  <p className="mt-1 text-xs muted">{labelFromMap(t.labels.itemTypes, item.type)}</p>
                </div>
                <span className={`badge ${badgeClass(item.status)}`}>{labelFromMap(t.labels.statuses, item.status)}</span>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${statusProgress(item.status)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel panel-pad grid gap-4 md:grid-cols-[1fr_1fr]">
        <div>
          <h2 className="text-lg font-semibold">{ui.quickActions}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/practice" className="btn-secondary">{t.actions.startPractice}</Link>
            <Link href="/review" className="btn-secondary">{t.review.headline}</Link>
            <Link href="/import" className="btn-secondary">{t.common.importThesis}</Link>
          </div>
        </div>
        <div>
          <h2 className="text-lg font-semibold">{ui.dailyNote}</h2>
          <p className="mt-2 text-sm muted">
            {t.home.evidenceSummary(stats.evidenceUnits, stats.prepTotal)}<Link href="/library" className="font-semibold text-[#006b5b]">{t.home.librarySettings}</Link>
          </p>
        </div>
      </section>
    </section>
  );
}

function Metric({ label, value, total, tone = "green" }: { label: string; value: number; total?: number; tone?: "green" | "amber" | "red" }) {
  const percent = total ? Math.min(100, Math.round((value / total) * 100)) : null;
  return (
    <div className="metric-card">
      <span className="block text-xs font-semibold text-[#64716b]">{label}</span>
      <span className={`mt-2 block text-3xl font-semibold tabular-nums ${tone === "red" ? "text-[#c0263d]" : ""}`}>{value}</span>
      {percent !== null ? (
        <div className="mt-3 progress-track">
          <div className="progress-fill" style={{ width: `${percent}%`, background: tone === "amber" ? "#b7791f" : tone === "red" ? "#c0263d" : undefined }} />
        </div>
      ) : null}
    </div>
  );
}

function ProgressRow({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = Math.min(100, Math.round((value / total) * 100));
  return (
    <div className="grid grid-cols-[120px_1fr_auto] items-center gap-3 text-sm">
      <span className="muted">{label}</span>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="tabular-nums muted">{value} / {total}</span>
    </div>
  );
}

function badgeClass(status: string): string {
  if (status === "verified") return "badge-green";
  if (status === "needs_review") return "badge-amber";
  if (status === "unsafe") return "badge-red";
  return "badge-zinc";
}

function statusProgress(status: string): number {
  if (status === "verified") return 100;
  if (status === "needs_review") return 62;
  if (status === "unsafe") return 18;
  return 38;
}

function dashboardLabels(locale: "en" | "zh-CN") {
  if (locale === "zh-CN") {
    return {
      estimate: "预计用时 20-30 分钟",
      viewDetails: "查看详情",
      todayPlan: "今日计划",
      inProgress: "进行中",
      upNext: "待开始",
      planDays: "计划天数",
      aiPlan: "AI 计划",
      staticPlan: "静态计划",
      overview: "今日准备概览",
      evidenceCoverage: "证据覆盖",
      prepReadiness: "准备度",
      reviewClearance: "复盘清理",
      reviewQueue: "复盘队列",
      viewAll: "查看全部",
      needsFollowup: "需要进一步练习",
      materialStatus: "材料状态",
      openMaterials: "打开材料库",
      quickActions: "快速操作",
      dailyNote: "今日记要",
      localTemplate: "本地模板",
      timeSlots: ["09:00", "11:00", "14:00", "16:00", "19:00", "20:30", "22:00"],
    };
  }
  return {
    estimate: "Estimated time: 20-30 minutes",
    viewDetails: "View details",
    todayPlan: "Today's plan",
    inProgress: "In progress",
    upNext: "Up next",
    planDays: "Plan days",
    aiPlan: "AI plan",
    staticPlan: "Static plan",
    overview: "Today's prep overview",
    evidenceCoverage: "Evidence coverage",
    prepReadiness: "Prep readiness",
    reviewClearance: "Review clearance",
    reviewQueue: "Review queue",
    viewAll: "View all",
    needsFollowup: "Needs follow-up practice",
    materialStatus: "Material status",
    openMaterials: "Open materials",
    quickActions: "Quick actions",
    dailyNote: "Daily note",
    localTemplate: "Local template",
    timeSlots: ["09:00", "11:00", "14:00", "16:00", "19:00", "20:30", "22:00"],
  };
}
