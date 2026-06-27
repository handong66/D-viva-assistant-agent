import Link from "next/link";
import { appContext } from "../../lib/server/context";
import { getActiveThesis, getLatestPracticeRun } from "../../db/repository";
import { StartForm } from "./start-form";
import { AnswerForm } from "./answer-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIMS = ["evidence", "clarity", "completeness", "boundary", "delivery"] as const;

export default async function PracticePage() {
  const { db, config } = await appContext();
  const thesis = getActiveThesis(db);
  if (!thesis) {
    return (
      <section className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold">Practice</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Import a thesis first.</p>
        <Link href="/import" className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">Import a thesis</Link>
      </section>
    );
  }

  const run = getLatestPracticeRun(db, thesis.id);
  const sttReady = config.sttProvider === "google_cloud" && config.sttConfigured;
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Practice</h1>
        <StartForm />
      </div>

      {!run ? (
        <p className="text-zinc-600 dark:text-zinc-400">Generate a question to begin.</p>
      ) : (
        <article className="flex flex-col gap-5 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{run.questionKind.replace("_", " ")} question</span>
            <p className="mt-1 font-medium">{run.question}</p>
          </div>

          {!run.scores ? (
            <AnswerForm runId={run.id} sttReady={sttReady} />
          ) : (
            <div className="flex flex-col gap-4">
              {run.answerText ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">Your answer:</span> {run.answerText}
                </p>
              ) : null}
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {DIMS.map((d) => {
                  const v = run.scores?.[d];
                  return (
                    <div key={d} className="rounded-md border border-zinc-200 p-2 text-center dark:border-zinc-800">
                      <dt className="text-[11px] uppercase text-zinc-500">{d}</dt>
                      <dd className={`text-lg font-semibold ${v !== undefined && v <= 2 ? "text-red-600 dark:text-red-400" : ""}`}>{v ?? "–"}</dd>
                    </div>
                  );
                })}
              </dl>
              {run.diagnosis ? <Field label="Diagnosis">{run.diagnosis}</Field> : null}
              {run.rewrite ? <Field label="Suggested rewrite">{run.rewrite}</Field> : null}
              {run.followUps && run.followUps.length > 0 ? (
                <div>
                  <h3 className="text-sm font-medium">Follow-up questions</h3>
                  <ul className="mt-1 list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                    {run.followUps.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </article>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{label}</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{children}</p>
    </div>
  );
}
