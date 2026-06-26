"use client";

import { useActionState, useState } from "react";
import { importThesisAction, type ImportState } from "../_actions/thesis";

const initialState: ImportState = { error: null };

export function ImportForm() {
  const [state, action, isPending] = useActionState(importThesisAction, initialState);
  const [sourceKind, setSourceKind] = useState("md");

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Title</span>
        <input
          name="title"
          required
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Source</span>
        <select
          name="sourceKind"
          value={sourceKind}
          onChange={(event) => setSourceKind(event.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="md">Markdown</option>
          <option value="txt">Plain text</option>
          <option value="pdf">PDF</option>
        </select>
      </label>

      {sourceKind === "pdf" ? (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">PDF file</span>
          <input
            type="file"
            name="file"
            accept="application/pdf"
            required
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-950 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white dark:file:bg-zinc-50 dark:file:text-zinc-950"
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Content</span>
          <textarea
            name="content"
            rows={12}
            required
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
        className="self-start rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {isPending ? "Importing..." : "Import"}
      </button>
    </form>
  );
}
