import { ImportForm } from "./import-form";

export const runtime = "nodejs";

export default function ImportPage() {
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold">Import a thesis</h2>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Paste Markdown/text or upload a PDF. Importing replaces the current active thesis.
        </p>
      </div>
      <ImportForm />
    </section>
  );
}
