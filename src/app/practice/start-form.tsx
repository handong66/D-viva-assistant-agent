"use client";
import { useActionState } from "react";
import { startPracticeAction } from "../_actions/practice";

const KINDS = [
  { value: "random", label: "Random" },
  { value: "cross_section", label: "Cross-section" },
  { value: "hostile", label: "Hostile" },
  { value: "boundary", label: "Boundary" },
];

export function StartForm() {
  const [state, action, pending] = useActionState(startPracticeAction, { error: null });
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Question type</span>
        <select name="kind" defaultValue="random" className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Topic (optional)</span>
        <input
          name="topic"
          type="text"
          placeholder="e.g. methodology, sample size"
          className="w-64 rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <button type="submit" disabled={pending} className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950">
        {pending ? "Generating…" : "Generate question"}
      </button>
      {state.error ? <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p> : null}
    </form>
  );
}
