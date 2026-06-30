import { ImportForm } from "./import-form";
import { getConfig } from "../../lib/config";
import { getUiCopy } from "../../lib/ui-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ImportPage() {
  const config = getConfig();
  const t = getUiCopy(config.uiLocale).importPage;

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="page-title">{t.title}</h2>
        <p className="mt-2 max-w-2xl text-sm muted">{t.body}</p>
      </div>
      <ImportForm locale={config.uiLocale} />
    </section>
  );
}
