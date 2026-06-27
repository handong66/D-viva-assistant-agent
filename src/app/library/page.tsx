import Link from "next/link";
import { switchThesisAction } from "../_actions/thesis";
import { appContext } from "../../lib/server/context";
import { getActiveThesis, getThesisStats, listTheses } from "../../db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const { db, config } = await appContext();
  const thesis = getActiveThesis(db);
  const aiReady = config.effectiveAiEnabled && config.gatewayConfigured;

  return (
    <section className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Library &amp; settings</h1>

      <Panel title="Active thesis">
        {thesis ? (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Field label="Title">{thesis.title}</Field>
            <Field label="Author">{thesis.author ?? "—"}</Field>
            <Field label="Source">{thesis.sourceKind.toUpperCase()}</Field>
            <Field label="Imported">{thesis.createdAt.slice(0, 10)}</Field>
          </dl>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No thesis imported. <Link href="/import" className="underline">Import one</Link>.</p>
        )}
      </Panel>

      <Panel title="Your theses">
        <ul className="divide-y divide-zinc-800">
          {listTheses(db).map((thesis) => (
            <li key={thesis.id}>
              <div className="flex items-center justify-between py-3 px-1">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{thesis.title}</p>
                  <p className="text-xs text-zinc-400">{thesis.source_kind.toUpperCase()} · {thesis.created_at.slice(0, 10)}</p>
                </div>
                {thesis.is_active ? (
                  <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">Active</span>
                ) : (
                  <form action={switchThesisAction}>
                    <input type="hidden" name="thesisId" value={thesis.id} />
                    <button type="submit" className="text-xs text-zinc-400 hover:text-zinc-100 transition-colors">Make active</button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="AI &amp; privacy">
        <ul className="flex flex-col gap-2 text-sm">
          <li>
            <b>AI examiner / judge / prep generation:</b>{" "}
            {aiReady
              ? "enabled — content is sent to your configured AI Gateway provider: generating a prep pack sends the thesis title and its bound evidence; generating a question or scoring an answer sends the question text, the relevant bound evidence, and your answer (typed or transcribed); a follow-up also includes the previous question and answer."
              : config.effectiveAiEnabled && !config.gatewayConfigured
                ? "off — a provider key is set but AI_GATEWAY_API_KEY is not, so nothing is sent."
                : "disabled — no thesis text or answers are sent anywhere."}
          </li>
          <li>
            <b>Speech-to-text:</b>{" "}
            {config.sttProvider === "off"
              ? "off — no audio is captured or sent."
              : config.sttProvider === "browser"
                ? "browser — audio is transcribed locally by your browser."
                : "Google Cloud — recorded audio is sent to Google Cloud Speech-to-Text for transcription."}
          </li>
        </ul>
        <p className="mt-3 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Your thesis, database, and recordings are always stored locally.
          {!aiReady && config.sttProvider === "off" ? " In this configuration, nothing leaves your machine." : ""}
        </p>
      </Panel>

      <Panel title="Content accuracy">
        {thesis ? <AccuracyPanel db={db} thesisId={thesis.id} /> : <p className="text-sm text-zinc-600 dark:text-zinc-400">Import a thesis to see accuracy stats.</p>}
      </Panel>
    </section>
  );
}

function AccuracyPanel({ db, thesisId }: { db: import("better-sqlite3").Database; thesisId: string }) {
  const s = getThesisStats(db, thesisId);
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Field label="Verified">{s.prepVerified}</Field>
        <Field label="Needs review">{s.prepNeedsReview}</Field>
        <Field label="Unsafe">{s.prepUnsafe}</Field>
        <Field label="Draft">{s.prepDraft}</Field>
      </dl>
      <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        Only prep items whose key facts are deterministically provable against their bound evidence are marked <b>verified</b>. Everything else stays <b>needs review</b>, <b>unsafe</b>, or <b>draft</b> — the app never presents an unverified claim as fact.
      </p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-zinc-500">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
