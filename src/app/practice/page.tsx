import Link from "next/link";
import { appContext } from "../../lib/server/context";
import { sttUiMode } from "../../lib/stt/mode";
import { getActiveThesis, getLatestPracticeRun, getRunReviewItems } from "../../db/repository";
import { getUiCopy, labelFromMap } from "../../lib/ui-copy";
import { StartForm } from "./start-form";
import { AnswerForm } from "./answer-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIMS = ["evidence", "clarity", "completeness", "boundary", "delivery"] as const;

export default async function PracticePage() {
  const { db, config } = await appContext();
  const t = getUiCopy(config.uiLocale);
  const thesis = getActiveThesis(db);
  if (!thesis) {
    return (
      <section className="panel panel-pad flex max-w-2xl flex-col items-start gap-4">
        <h1 className="page-title">{t.practice.title}</h1>
        <p className="muted">{t.common.importFirst}</p>
        <Link href="/import" className="btn-primary">{t.common.importThesis}</Link>
      </section>
    );
  }

  const run = getLatestPracticeRun(db, thesis.id);
  const sttMode = sttUiMode(config);
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="page-title">{t.practice.title}</h1>
        <StartForm locale={config.uiLocale} />
      </div>

      {!run ? (
        <p className="panel panel-pad muted">{t.practice.begin}</p>
      ) : (
        <article className="panel panel-pad flex flex-col gap-5">
          <div>
            <span className="section-kicker">
              {t.practice.question(labelFromMap(t.labels.questionKinds, run.questionKind))}
            </span>
            <p className="mt-2 text-lg font-semibold">{run.question}</p>
          </div>

          {!run.scores ? (
            <AnswerForm runId={run.id} sttMode={sttMode} locale={config.uiLocale} />
          ) : (() => {
            const weak = getRunReviewItems(db, run.id);
            return (
            <div className="flex flex-col gap-4">
              {run.answerText ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  <span className="font-semibold text-[#17211d]">{t.practice.yourAnswer}</span> {run.answerText}
                </p>
              ) : null}
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {DIMS.map((d) => {
                  const v = run.scores?.[d];
                  return (
                    <div key={d} className="metric-card text-center">
                      <dt className="text-[11px] font-semibold text-[#64716b]">{labelFromMap(t.labels.dimensions, d)}</dt>
                      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${v !== undefined && v <= 2 ? "text-[#c0263d]" : ""}`}>{v ?? "–"}</dd>
                    </div>
                  );
                })}
              </dl>
              {weak.length > 0 ? (
                <div className="rounded-lg border border-[#f1d6dc] bg-[#fff7f8] p-4">
                  <h3 className="text-sm font-medium">{t.practice.weakReasons}</h3>
                  <ul className="mt-2 flex flex-col gap-1 text-sm muted">
                    {weak.map((w) => (
                      <li key={w.dimension}><span className="font-semibold text-[#c0263d]">{labelFromMap(t.labels.dimensions, w.dimension)} · {w.score}/5</span>{w.reason ? ` - ${w.reason}` : ""}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {run.diagnosis ? <Field label={t.practice.diagnosis}>{run.diagnosis}</Field> : null}
              {run.rewrite ? <Field label={t.practice.rewrite}>{run.rewrite}</Field> : null}
              {run.followUps && run.followUps.length > 0 ? (
                <div>
                  <h3 className="text-sm font-medium">{t.practice.followUps}</h3>
                  <ul className="mt-1 list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                    {run.followUps.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
            );
          })()}
        </article>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{label}</h3>
      <p className="mt-1 text-sm muted">{children}</p>
    </div>
  );
}
