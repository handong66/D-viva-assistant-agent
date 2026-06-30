import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { appContext } from "../../../../lib/server/context";
import { getActiveThesis, getPrepItemForEdit, getBoundEvidence } from "../../../../db/repository";
import { editableFields } from "../../../../lib/prep/edit";
import { getUiCopy, labelFromMap } from "../../../../lib/ui-copy";
import { editPrepItemAction } from "../../../_actions/prep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditPrepItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, config } = await appContext();
  const copy = getUiCopy(config.uiLocale);
  const t = copy.editItem;
  const thesis = getActiveThesis(db);
  if (!thesis) redirect("/import");
  const item = getPrepItemForEdit(db, id);
  if (!item || item.thesisId !== thesis.id) notFound();
  const bound = getBoundEvidence(db, id);
  const f = editableFields(item.type);
  const itemType = labelFromMap(copy.labels.itemTypes, item.type);

  const input = "field";
  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="page-title">{t.title}</h1>
        <p className="mt-2 text-sm muted">{t.note(itemType)}</p>
      </div>

      <div className="panel panel-pad text-sm">
        <p className="font-semibold">{t.boundEvidence}</p>
        {bound.length === 0 ? (
          <p className="mt-1 muted">{t.noEvidence}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 muted">{bound.map((e) => <li key={e.id}>“{e.text}”</li>)}</ul>
        )}
      </div>

      <form action={editPrepItemAction} className="panel panel-pad flex flex-col gap-4">
        <input type="hidden" name="prepItemId" value={item.id} />
        {f.claim ? (
          <label className="flex flex-col gap-1 text-sm font-medium">{t.claim}
            <textarea name="claimText" rows={3} defaultValue={item.claimText ?? ""} className={input} />
          </label>
        ) : (
          <p className="text-sm muted">{t.fixedClaim} <span className="text-[#17211d]">{item.claimText ?? item.title}</span></p>
        )}
        {f.quote ? (
          <label className="flex flex-col gap-1 text-sm font-medium">{t.supportingQuote}
            <textarea name="evidenceQuote" rows={3} defaultValue={item.evidenceQuote ?? ""} className={input} />
          </label>
        ) : null}
        {f.num ? (
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium">{t.value}
              <input name="valueNumeric" type="number" step="any" defaultValue={item.valueNumeric ?? ""} className={input} />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium">{t.unit}
              <input name="unit" type="text" defaultValue={item.unit ?? ""} className={input} />
            </label>
          </div>
        ) : null}
        <div className="flex gap-3">
          <button type="submit" className="btn-primary">{t.save}</button>
          <Link href="/materials" className="btn-secondary">{t.cancel}</Link>
        </div>
      </form>
    </section>
  );
}
