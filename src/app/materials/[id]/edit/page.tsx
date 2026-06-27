import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { appContext } from "../../../../lib/server/context";
import { getActiveThesis, getPrepItemForEdit, getBoundEvidence } from "../../../../db/repository";
import { editableFields } from "../../../../lib/prep/edit";
import { editPrepItemAction } from "../../../_actions/prep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditPrepItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await appContext();
  const thesis = getActiveThesis(db);
  if (!thesis) redirect("/import");
  const item = getPrepItemForEdit(db, id);
  if (!item || item.thesisId !== thesis.id) notFound();
  const bound = getBoundEvidence(db, id);
  const f = editableFields(item.type);

  const input = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Edit prep item</h1>
        <p className="text-sm text-zinc-500">{item.type.replaceAll("_", " ")} · re-validated against its bound evidence on save.</p>
      </div>

      <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <p className="font-medium">Bound evidence</p>
        {bound.length === 0 ? (
          <p className="mt-1 text-zinc-500">No evidence bound — this item can’t be verified.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1 text-zinc-600 dark:text-zinc-400">{bound.map((e) => <li key={e.id}>“{e.text}”</li>)}</ul>
        )}
      </div>

      <form action={editPrepItemAction} className="flex flex-col gap-4">
        <input type="hidden" name="prepItemId" value={item.id} />
        {f.claim ? (
          <label className="flex flex-col gap-1 text-sm font-medium">Claim
            <textarea name="claimText" rows={3} defaultValue={item.claimText ?? ""} className={input} />
          </label>
        ) : (
          <p className="text-sm text-zinc-500">Claim (fixed): <span className="text-zinc-700 dark:text-zinc-300">{item.claimText ?? item.title}</span></p>
        )}
        {f.quote ? (
          <label className="flex flex-col gap-1 text-sm font-medium">Supporting quote (must appear verbatim in the bound evidence above)
            <textarea name="evidenceQuote" rows={3} defaultValue={item.evidenceQuote ?? ""} className={input} />
          </label>
        ) : null}
        {f.num ? (
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium">Value
              <input name="valueNumeric" type="number" step="any" defaultValue={item.valueNumeric ?? ""} className={input} />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium">Unit
              <input name="unit" type="text" defaultValue={item.unit ?? ""} className={input} />
            </label>
          </div>
        ) : null}
        <div className="flex gap-3">
          <button type="submit" className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">Save &amp; re-validate</button>
          <Link href="/materials" className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700">Cancel</Link>
        </div>
      </form>
    </section>
  );
}
