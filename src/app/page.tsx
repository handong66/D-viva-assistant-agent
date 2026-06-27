import Link from "next/link";
import { appContext } from "../lib/server/context";
import { getActiveThesis, getThesisStats } from "../db/repository";
import { recommendNextAction } from "../lib/dashboard";
import { currentDayNumber, planPhase, TOTAL_DAYS } from "../lib/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const { db, config } = await appContext();
  const thesis = getActiveThesis(db);

  if (!thesis) {
    return (
      <section className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold">No thesis yet</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Import a thesis to start preparing for your viva.</p>
        <Link href="/import" className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">Import a thesis</Link>
      </section>
    );
  }

  const stats = getThesisStats(db, thesis.id);
  const aiReady = config.effectiveAiEnabled && config.gatewayConfigured;
  const next = recommendNextAction(stats, aiReady);
  const today = currentDayNumber(thesis.createdAt, TOTAL_DAYS);
  const phase = planPhase(today);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{thesis.title}</h1>
        {thesis.author ? <p className="text-zinc-600 dark:text-zinc-400">{thesis.author}</p> : null}
      </div>

      <Link href={next.href} className="flex items-center justify-between rounded-lg bg-zinc-950 px-5 py-4 text-white dark:bg-zinc-50 dark:text-zinc-950">
        <span className="text-sm font-medium">Recommended next: {next.label}</span>
        <span aria-hidden>→</span>
      </Link>

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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Verified" value={stats.prepVerified} href="/materials" />
        <Stat label="Needs review" value={stats.prepNeedsReview} href="/materials" />
        <Stat label="Practice runs" value={stats.practiceRuns} href="/practice" />
        <Stat label="To review" value={stats.openReviews} href="/review" />
      </div>

      <p className="text-sm text-zinc-500">
        {stats.evidenceUnits} evidence units · {stats.prepTotal} prep items · <Link href="/library" className="underline">library &amp; settings</Link>
      </p>
    </section>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900">
      <span className="block text-xs uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="mt-1 block text-2xl font-semibold">{value}</span>
    </Link>
  );
}
