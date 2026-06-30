import Link from "next/link";
import { switchThesisAction } from "../_actions/thesis";
import { appContext } from "../../lib/server/context";
import { getActiveThesis, getThesisStats, listTheses } from "../../db/repository";
import { getUiCopy, type UiLocale } from "../../lib/ui-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const { db, config } = await appContext();
  const t = getUiCopy(config.uiLocale);
  const thesis = getActiveThesis(db);
  const aiReady = config.effectiveAiEnabled && config.gatewayConfigured;

  return (
    <section className="flex flex-col gap-6">
      <h1 className="page-title">{t.library.title}</h1>

      <Panel title={t.library.activeThesis}>
        {thesis ? (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Field label={t.library.titleField}>{thesis.title}</Field>
            <Field label={t.library.author}>{thesis.author ?? t.common.none}</Field>
            <Field label={t.library.source}>{thesis.sourceKind.toUpperCase()}</Field>
            <Field label={t.library.imported}>{thesis.createdAt.slice(0, 10)}</Field>
          </dl>
        ) : (
          <p className="text-sm muted">{t.library.noImported} <Link href="/import" className="font-semibold text-[#006b5b]">{t.library.importOne}</Link>.</p>
        )}
      </Panel>

      <Panel title={t.library.yourTheses}>
        <ul className="divide-y divide-[#e4ebe8]">
          {listTheses(db).map((thesis) => (
            <li key={thesis.id}>
              <div className="flex items-center justify-between py-3 px-1">
                <div>
                  <p className="text-sm font-semibold">{thesis.title}</p>
                  <p className="text-xs muted">{thesis.source_kind.toUpperCase()} · {thesis.created_at.slice(0, 10)}</p>
                </div>
                {thesis.is_active ? (
                  <span className="badge badge-green">{t.library.active}</span>
                ) : (
                  <form action={switchThesisAction}>
                    <input type="hidden" name="thesisId" value={thesis.id} />
                    <button type="submit" className="btn-secondary min-h-0 px-3 py-1.5 text-xs">{t.library.makeActive}</button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={t.library.aiPrivacy}>
        <ul className="flex flex-col gap-3 text-sm">
          <li>
            <b>{t.library.aiLabel}</b>{" "}
            {aiReady
              ? t.library.aiEnabled
              : config.effectiveAiEnabled && !config.gatewayConfigured
                ? t.library.aiGatewayMissing
                : t.library.aiDisabled}
          </li>
          <li>
            <b>{t.library.sttLabel}</b>{" "}
            {config.sttProvider === "off"
              ? t.library.sttOff
              : config.sttProvider === "browser"
                ? t.library.sttBrowser
                : t.library.sttGoogle}
          </li>
        </ul>
        <p className="mt-3 max-w-2xl text-sm muted">
          {t.library.localData}
          {!aiReady && config.sttProvider === "off" ? t.library.nothingLeaves : ""}
        </p>
      </Panel>

      <Panel title={t.library.accuracy}>
        {thesis ? <AccuracyPanel db={db} thesisId={thesis.id} locale={config.uiLocale} /> : <p className="text-sm muted">{t.library.importStats}</p>}
      </Panel>
    </section>
  );
}

function AccuracyPanel({ db, thesisId, locale }: { db: import("better-sqlite3").Database; thesisId: string; locale: UiLocale }) {
  const t = getUiCopy(locale);
  const s = getThesisStats(db, thesisId);
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Field label={t.home.verified}>{s.prepVerified}</Field>
        <Field label={t.home.needsReview}>{s.prepNeedsReview}</Field>
        <Field label={t.library.unsafe}>{s.prepUnsafe}</Field>
        <Field label={t.library.draft}>{s.prepDraft}</Field>
      </dl>
      <p className="max-w-2xl text-sm muted">
        {t.library.accuracyBody}
      </p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel panel-pad flex flex-col gap-3">
      <h2 className="section-kicker">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-[#64716b]">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
