import Link from "next/link";
import { getActiveThesis, getPrepItems, type PrepItemRow } from "../../db/repository";
import { appContext } from "../../lib/server/context";
import GenerateButton from "./generate-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusBadge: Record<string, string> = {
  verified: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  needs_review: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  unsafe: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export default async function MaterialsPage() {
  const { db } = await appContext();
  const thesis = getActiveThesis(db);

  if (!thesis) {
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold">Materials</h1>
        <p className="max-w-xl text-zinc-600 dark:text-zinc-400">
          No active thesis. Please import a thesis first.
        </p>
        <Link
          href="/import"
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Import a thesis
        </Link>
      </div>
    );
  }

  const items = getPrepItems(db, thesis.id);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Materials</h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">{thesis.title}</p>
        </div>
        <GenerateButton />
      </div>

      {items.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No prep items yet. Click Generate Prep Pack to create your study materials.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <PrepItem key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PrepItem({ item }: { item: PrepItemRow }) {
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase text-zinc-500">
          {item.type.replaceAll("_", " ")}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge[item.status] ?? statusBadge.draft}`}>
          {item.status.replaceAll("_", " ")}
        </span>
      </div>
      <h2 className="mt-2 font-semibold">{item.title}</h2>
      {item.claimText ? <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{item.claimText}</p> : null}
    </li>
  );
}
