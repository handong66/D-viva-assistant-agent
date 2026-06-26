import Link from "next/link";
import { appContext } from "../../lib/server/context";
import { getActiveThesis, getReviewItems } from "../../db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { db } = await appContext();
  const thesis = getActiveThesis(db);
  if (!thesis) {
    return (
      <section className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Import a thesis first.</p>
        <Link href="/import" className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">Import a thesis</Link>
      </section>
    );
  }

  const items = getReviewItems(db, thesis.id);
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Dimensions scored 2 or below — worth another pass. <Link href="/practice" className="underline">Practice more →</Link>
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">Nothing to review. Answer some practice questions first, or you are all caught up.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((it) => (
            <li key={it.id} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300">{it.dimension} · {it.score}/5</span>
              </div>
              <p className="mt-2 text-sm font-medium">{it.question}</p>
              {it.reason ? <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{it.reason}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
