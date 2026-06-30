"use client";
import { useActionState } from "react";
import { startPracticeAction } from "../_actions/practice";
import { getUiCopy, type UiLocale } from "../../lib/ui-copy";

export function StartForm({ locale }: { locale: UiLocale }) {
  const t = getUiCopy(locale);
  const kinds = [
    { value: "random", label: t.labels.questionKinds.random },
    { value: "cross_section", label: t.labels.questionKinds.cross_section },
    { value: "hostile", label: t.labels.questionKinds.hostile },
    { value: "boundary", label: t.labels.questionKinds.boundary },
  ];
  const [state, action, pending] = useActionState(startPracticeAction, { error: null });
  return (
    <form action={action} className="panel panel-pad flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t.practice.questionType}</span>
        <select name="kind" defaultValue="random" className="field w-40">
          {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t.practice.topic}</span>
        <input
          name="topic"
          type="text"
          placeholder={t.practice.topicPlaceholder}
          className="field w-72 max-w-full"
        />
      </label>
      <button type="submit" disabled={pending} className="btn-primary disabled:opacity-50">
        {pending ? t.practice.generating : t.practice.generateQuestion}
      </button>
      {state.error ? <p className="w-full text-sm text-[#c0263d]">{state.error}</p> : null}
    </form>
  );
}
