"use client";

import { useActionState } from "react";
import { generatePrepPackAction, type GenerateState } from "../_actions/prep";

const initialState: GenerateState = { error: null, generated: null };

export default function GenerateButton() {
  const [state, formAction, isPending] = useActionState<GenerateState, FormData>(
    generatePrepPackAction,
    initialState,
  );

  return (
    <form action={formAction}>
      <button type="submit" disabled={isPending}>
        {isPending ? "Generating…" : "Generate Prep Pack"}
      </button>
      {state.error ? <p className="mt-2 text-red-600">{state.error}</p> : null}
      {state.generated !== null ? (
        <p className="mt-2 text-green-600">Generated {state.generated} items.</p>
      ) : null}
    </form>
  );
}
