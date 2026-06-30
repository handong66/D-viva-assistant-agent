"use client";

import { useActionState } from "react";
import { generatePrepPackAction, type GenerateState } from "../_actions/prep";
import { getUiCopy, type UiLocale } from "../../lib/ui-copy";

const initialState: GenerateState = { error: null, generated: null };

export default function GenerateButton({ locale }: { locale: UiLocale }) {
  const t = getUiCopy(locale).materials;
  const [state, formAction, isPending] = useActionState<GenerateState, FormData>(
    generatePrepPackAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <button type="submit" disabled={isPending} className="btn-primary disabled:opacity-50">
        {isPending ? t.generating : t.generate}
      </button>
      {state.error ? <p className="text-sm text-[#c0263d]">{state.error}</p> : null}
      {state.generated !== null ? (
        <p className="text-sm text-[#006b5b]">{t.generated(state.generated)}</p>
      ) : null}
    </form>
  );
}
