import Link from "next/link";
import { getActiveThesis, getPrepItems, type PrepItemRow } from "../../db/repository";
import { appContext } from "../../lib/server/context";
import { getUiCopy, labelFromMap, type UiLocale } from "../../lib/ui-copy";
import GenerateButton from "./generate-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusBadge: Record<string, string> = {
  verified: "badge-green",
  needs_review: "badge-amber",
  unsafe: "badge-red",
  draft: "badge-zinc",
};

export default async function MaterialsPage() {
  const { db, config } = await appContext();
  const t = getUiCopy(config.uiLocale);
  const thesis = getActiveThesis(db);

  if (!thesis) {
    return (
      <div className="panel panel-pad flex max-w-2xl flex-col items-start gap-4">
        <h1 className="page-title">{t.materials.title}</h1>
        <p className="max-w-xl muted">
          {t.common.noActiveThesis}
        </p>
        <Link href="/import" className="btn-primary">
          {t.common.importThesis}
        </Link>
      </div>
    );
  }

  const items = getPrepItems(db, thesis.id);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">{t.materials.title}</h1>
          <p className="mt-2 text-sm muted">{thesis.title}</p>
        </div>
        <GenerateButton locale={config.uiLocale} />
      </div>

      {items.length === 0 ? (
        <p className="panel panel-pad muted">
          {t.materials.empty}
        </p>
      ) : (
        <ul className="panel divide-y divide-[#e4ebe8]">
          {items.map((item) => (
            <PrepItem key={item.id} item={item} locale={config.uiLocale} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PrepItem({ item, locale }: { item: PrepItemRow; locale: UiLocale }) {
  const t = getUiCopy(locale);
  const basis = labelFromMap(t.labels.support, item.supportKind ?? "");
  const supportValue = truncateSupportValue(item.supportValue);
  const statusLabel = labelFromMap(t.labels.statuses, item.status);

  return (
    <li className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="section-kicker normal-case">
            {labelFromMap(t.labels.itemTypes, item.type)}
          </span>
          <span className={`badge ${statusBadge[item.status] ?? statusBadge.draft}`}>
            {item.status === "verified" && basis ? `${statusLabel} · ${basis}` : statusLabel}
          </span>
        </div>
        <h2 className="mt-2 text-base font-semibold">{item.title}</h2>
        {item.claimText ? <p className="mt-1 max-w-3xl text-sm muted">{item.claimText}</p> : null}
        {item.status === "verified" && (item.type === "key_number" || item.type === "citation_card") ? (
          <p className="mt-2 max-w-3xl text-xs italic muted">
            {t.materials.verifiedNote(basis, supportValue)}
          </p>
        ) : null}
      </div>
      <div className="flex justify-start sm:justify-end">
        <Link
          href={`/materials/${item.id}/edit`}
          className="btn-secondary min-h-0 px-3 py-1.5 text-xs"
        >
          {t.materials.edit}
        </Link>
      </div>
    </li>
  );
}

function truncateSupportValue(value: string | null): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized;
}
