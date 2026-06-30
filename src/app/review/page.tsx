import Link from "next/link";
import { appContext } from "../../lib/server/context";
import { getActiveThesis, getReviewItems } from "../../db/repository";
import { getUiCopy, labelFromMap } from "../../lib/ui-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { db, config } = await appContext();
  const t = getUiCopy(config.uiLocale);
  const thesis = getActiveThesis(db);
  if (!thesis) {
    return (
      <section className="panel panel-pad flex max-w-2xl flex-col items-start gap-4">
        <h1 className="page-title">{t.review.headline}</h1>
        <p className="muted">{t.common.importFirst}</p>
        <Link href="/import" className="btn-primary">{t.common.importThesis}</Link>
      </section>
    );
  }

  const items = getReviewItems(db, thesis.id);
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">{t.review.title}</h1>
        <p className="mt-2 text-sm muted">
          {t.review.body} <Link href="/practice" className="font-semibold text-[#006b5b]">{t.review.practiceMore}</Link>
        </p>
      </div>

      {items.length === 0 ? (
        <p className="panel panel-pad muted">{t.review.empty}</p>
      ) : (
        <ul className="panel divide-y divide-[#e4ebe8]">
          {items.map((it) => (
            <li key={it.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{it.question}</p>
                {it.reason ? <p className="mt-1 text-sm muted">{it.reason}</p> : null}
              </div>
              <span className="badge badge-red h-fit w-fit">{labelFromMap(t.labels.dimensions, it.dimension)} · {it.score}/5</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
