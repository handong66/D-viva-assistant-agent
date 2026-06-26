"use client";
import { useActionState } from "react";
import { submitAnswerAction } from "../_actions/practice";

export function AnswerForm({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState(submitAnswerAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="practiceRunId" value={runId} />
      <textarea name="answer" rows={8} required placeholder="Type your answer…" className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      <button type="submit" disabled={pending} className="self-start rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950">
        {pending ? "Scoring…" : "Submit answer"}
      </button>
      {state.error ? <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p> : null}
    </form>
  );
}
