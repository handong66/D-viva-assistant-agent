"use client";

import { useActionState, useState } from "react";
import { importThesisAction, type ImportState } from "../_actions/thesis";
import { getUiCopy, type UiLocale } from "../../lib/ui-copy";

const initialState: ImportState = { error: null };

export function ImportForm({ locale }: { locale: UiLocale }) {
  const [state, action, isPending] = useActionState(importThesisAction, initialState);
  const [sourceKind, setSourceKind] = useState("md");
  const t = getUiCopy(locale).importPage;

  return (
    <form action={action} className="panel panel-pad flex max-w-2xl flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t.titleField}</span>
        <input
          name="title"
          required
          className="field"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t.source}</span>
        <select
          name="sourceKind"
          value={sourceKind}
          onChange={(event) => setSourceKind(event.target.value)}
          className="field"
        >
          <option value="md">{t.markdown}</option>
          <option value="txt">{t.plainText}</option>
          <option value="pdf">{t.pdf}</option>
        </select>
      </label>

      {sourceKind === "pdf" ? (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t.pdfFile}</span>
          <input
            type="file"
            name="file"
            accept="application/pdf"
            required
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#004f43] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t.content}</span>
          <textarea
            name="content"
            rows={12}
            required
            className="field font-mono"
          />
        </label>
      )}

      {state.error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="btn-primary self-start disabled:opacity-50"
      >
        {isPending ? t.submitting : t.submit}
      </button>
    </form>
  );
}
