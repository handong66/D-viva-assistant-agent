import Link from "next/link";
import { countEvidence, getActiveThesis, getThesisChunks } from "../db/repository";
import { appContext } from "../lib/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const { db } = await appContext();
  const thesis = getActiveThesis(db);

  if (!thesis) {
    return (
      <section className="flex flex-col items-start gap-4">
        <h2 className="text-2xl font-semibold">No thesis yet</h2>
        <p className="max-w-xl text-zinc-600 dark:text-zinc-400">
          Import a thesis to start preparing for your viva.
        </p>
        <Link
          href="/import"
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Import a thesis
        </Link>
      </section>
    );
  }

  const chunks = getThesisChunks(db, thesis.id).length;
  const evidence = countEvidence(db, thesis.id);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold">{thesis.title}</h2>
        {thesis.author ? (
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">{thesis.author}</p>
        ) : null}
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <Stat label="Source" value={thesis.sourceKind.toUpperCase()} />
        <Stat label="Chunks" value={String(chunks)} />
        <Stat label="Evidence" value={String(evidence)} />
      </dl>

      <Link
        href="/import"
        className="text-sm text-zinc-600 underline hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        import a different thesis
      </Link>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <dt className="text-xs font-medium uppercase text-zinc-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}
