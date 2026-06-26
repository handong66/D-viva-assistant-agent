# M4b — Generate Prep Pack + Materials View Implementation Plan

> **For agentic workers:** This project runs the Claude↔Codex 老流程 (see `AGENTS.md`): **Codex implements** each task via `codex:codex-rescue` (`--write`); **Claude runs tests + reviews + commits** per task and at a milestone gate (绿测试≠Done). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the generate (§7 ②) + materials (§7 ④) slice to the running app: a "Generate prep pack" button that runs the M2 generator on the active thesis through the bridge's `appLlmClient`, and a `/materials` page that lists the resulting `prep_item`s with verified / needs_review / unsafe badges. **AI re-enters the UI here — it must degrade gracefully when no provider key is configured.**

**Architecture:** Reuse M2's `runPrepPackGeneration` (validator-gated, evidence-bound) unchanged. A Server Action checks `config.effectiveAiEnabled && config.gatewayConfigured` (the bridge only enables with AI Gateway) and short-circuits with a friendly message when AI is off (no model call). A read helper `getPrepItems` feeds the materials RSC. No new generation logic — M4b is wiring + display only.

**Tech Stack:** Next 16 App Router (RSC + Server Actions), React 19 (`useActionState`), Tailwind v4, better-sqlite3, vitest. AI only via `lib/llm` through the bridge; DB only via `appContext`; evidence-binding untouched (M2 owns it).

> **M4 decomposition:** M4a shell+import (shipped) → **M4b generate+materials (this plan)** → M4c practice+judge+review → M4d today/library/settings.
>
> **v1 scope notes (deferred, documented):** (a) "Generate" appends a new prep-pack run, but the materials view shows only the **latest done** run (see Task 1), so re-generating cleanly replaces what the user sees; per-type regenerate is later. (b) Editing a prep item (→ needs_review re-validate) is M4c/later. (c) The accuracy panel is M4d.

> **Revised after Codex design-review round 1** (CONDITIONAL GO → fixes integrated): **P1** `appContext()` is `async` (M4a shipped it async) — the action and `MaterialsPage` must `await` it. **P1** the LLM bridge only enables with AI Gateway, so the generate guard checks `effectiveAiEnabled && gatewayConfigured` with a gateway-specific message (else a user with only e.g. `ANTHROPIC_API_KEY` hits a confusing generic error). **P2** `getPrepItems` now filters to the latest **done** `prep_pack` run — de-dups re-generates AND excludes partial items from a run that finalized 'error' (items are inserted before the error finalizer runs).

---

## Contracts

```ts
// src/db/repository.ts
export type PrepItemRow = { id: string; type: string; title: string; claimText: string | null; status: string; validationStatus: string };
export function getPrepItems(db: DB, thesisId: string): PrepItemRow[];

// src/app/_actions/prep.ts — "use server"
export type GenerateState = { error: string | null; generated: number | null };
export async function generatePrepPackAction(prev: GenerateState, formData: FormData): Promise<GenerateState>;
```

## File structure

- **Modify** `src/db/repository.ts` (+`src/db/repository.prep-read.test.ts`) — `getPrepItems`.
- **Create** `src/app/_actions/prep.ts` — `generatePrepPackAction` (AI-disabled guard → `runPrepPackGeneration`).
- **Create** `src/app/materials/generate-button.tsx` — client button (`useActionState`).
- **Create** `src/app/materials/page.tsx` — RSC list + empty states; **Modify** `src/app/layout.tsx` — add the Materials nav link.

---

### Task 1: `getPrepItems` repository helper

**Files:** Modify `src/db/repository.ts`, Create `src/db/repository.prep-read.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/db/repository.prep-read.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { getPrepItems } from "./repository";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO generation_run (id,thesis_id,kind,status,created_at) VALUES ('r0','t1','prep_pack','done','2024-01-01T00:00:00Z');
    INSERT INTO generation_run (id,thesis_id,kind,status,created_at) VALUES ('r1','t1','prep_pack','done','2024-01-02T00:00:00Z');
    INSERT INTO generation_run (id,thesis_id,kind,status,created_at) VALUES ('rE','t1','prep_pack','error','2024-01-03T00:00:00Z');
    INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,claim_text,status,validation_status,validator_version,source)
      VALUES ('pOld','t1','r0','qa','Old pack','x','verified','passed','1','generated');
    INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,claim_text,status,validation_status,validator_version,source)
      VALUES ('p1','t1','r1','qa','Q one','paraphrase','needs_review','needs_review','1','generated');
    INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,claim_text,status,validation_status,validator_version,source)
      VALUES ('p2','t1','r1','key_number','Acc','81.3%','verified','passed','1','generated');
    INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,claim_text,status,validation_status,validator_version,source)
      VALUES ('pErr','t1','rE','qa','From errored run','y','needs_review','needs_review','1','generated');
  `);
}

describe("getPrepItems", () => {
  it("returns only the latest DONE prep_pack run's items, grouped by type (excludes older + errored runs)", () => {
    const db = makeTestDb(); seed(db);
    const items = getPrepItems(db, "t1");
    expect(items.map((i) => i.id)).toEqual(["p2", "p1"]); // only r1's items; ORDER BY type -> key_number before qa
    expect(items[0]).toMatchObject({ id: "p2", title: "Acc", claimText: "81.3%", status: "verified", validationStatus: "passed" });
    db.close();
  });
  it("returns [] when the thesis has no done prep_pack run", () => {
    const db = makeTestDb();
    db.exec(`INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);`);
    expect(getPrepItems(db, "t1")).toEqual([]);
    db.close();
  });
  it("breaks created_at ties by insertion order (rowid), not UUID order", () => {
    const db = makeTestDb();
    db.exec(`
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
      INSERT INTO generation_run (id,thesis_id,kind,status,created_at) VALUES ('zzz_first','t1','prep_pack','done','2024-01-05T00:00:00Z');
      INSERT INTO generation_run (id,thesis_id,kind,status,created_at) VALUES ('aaa_second','t1','prep_pack','done','2024-01-05T00:00:00Z');
      INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,status,validation_status,validator_version,source)
        VALUES ('pa','t1','zzz_first','qa','First','needs_review','needs_review','1','generated');
      INSERT INTO prep_item (id,thesis_id,generation_run_id,type,title,status,validation_status,validator_version,source)
        VALUES ('pb','t1','aaa_second','qa','Second','needs_review','needs_review','1','generated');
    `);
    // same created_at; 'aaa_second' inserted later (higher rowid) wins even though it sorts BEFORE 'zzz_first' lexically
    expect(getPrepItems(db, "t1").map((i) => i.title)).toEqual(["Second"]);
    db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/db/repository.prep-read.test.ts` — FAIL (`getPrepItems` not exported).

- [ ] **Step 3: Implement** — append to `src/db/repository.ts`:

```ts
export type PrepItemRow = { id: string; type: string; title: string; claimText: string | null; status: string; validationStatus: string };

export function getPrepItems(db: DB, thesisId: string): PrepItemRow[] {
  // Show only the latest successful prep-pack run: de-dups re-generates and hides
  // partial items left behind by a run that finalized 'error'.
  const rows = db
    .prepare(
      `SELECT id, type, title, claim_text, status, validation_status
         FROM prep_item
        WHERE thesis_id = ?
          AND generation_run_id = (
            SELECT id FROM generation_run
             WHERE thesis_id = ? AND kind = 'prep_pack' AND status = 'done'
             ORDER BY created_at DESC, rowid DESC LIMIT 1
          )
        ORDER BY type, created_at, id`,
    )
    .all(thesisId, thesisId) as { id: string; type: string; title: string; claim_text: string | null; status: string; validation_status: string }[];
  return rows.map((r) => ({
    id: r.id, type: r.type, title: r.title, claimText: r.claim_text, status: r.status, validationStatus: r.validation_status,
  }));
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (2).
- [ ] **Step 5: Commit** — `git commit -m "feat(m4b): getPrepItems repository helper (Task 1)"`

---

### Task 2: `generatePrepPackAction` server action (AI-disabled guard → M2 generator)

**Files:** Create `src/app/_actions/prep.ts`

No unit test (uses `appContext` over the process env + db singleton; `runPrepPackGeneration` is fully M2-unit-tested). Verified by build + the manual smoke (AI-off path) below.

- [ ] **Step 1: Implement**

```ts
// src/app/_actions/prep.ts
"use server";
import { revalidatePath } from "next/cache";
import { appContext, appLlmClient } from "../../lib/server/context";
import { getActiveThesis } from "../../db/repository";
import { runPrepPackGeneration } from "../../lib/llm/prep-pack-run";

export type GenerateState = { error: string | null; generated: number | null };

export async function generatePrepPackAction(_prev: GenerateState, _formData: FormData): Promise<GenerateState> {
  const { db, config } = await appContext();

  const thesis = getActiveThesis(db);
  if (!thesis) return { error: "Import a thesis first.", generated: null };

  // Graceful degrade (red line #4): the LLM bridge only enables with AI Gateway, so
  // mirror getLlmClient's gate exactly — no model call (and a clear message) otherwise.
  if (!config.effectiveAiEnabled || !config.gatewayConfigured) {
    return { error: "AI is disabled. Set AI_GATEWAY_API_KEY and VIVA_AI_ENABLED=true to generate a prep pack.", generated: null };
  }

  try {
    const client = await appLlmClient({ db, config });
    const res = await runPrepPackGeneration(db, client, thesis.id);
    revalidatePath("/materials");
    return { error: null, generated: res.itemCount };
  } catch (error) {
    console.error("[generatePrepPackAction] generation failed:", error);
    return { error: "Generation failed. Please try again.", generated: null };
  }
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` — exit 0.
- [ ] **Step 3: Commit** — `git commit -m "feat(m4b): generatePrepPackAction (AI-disabled guard + runPrepPackGeneration) (Task 2)"`

---

### Task 3: Generate button (client component)

**Files:** Create `src/app/materials/generate-button.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/app/materials/generate-button.tsx
"use client";
import { useActionState } from "react";
import { generatePrepPackAction, type GenerateState } from "../_actions/prep";

const initial: GenerateState = { error: null, generated: null };

export function GenerateButton() {
  const [state, action, pending] = useActionState(generatePrepPackAction, initial);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {pending ? "Generating…" : "Generate prep pack"}
      </button>
      {state.error ? <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p> : null}
      {state.generated != null ? <p className="text-sm text-green-700 dark:text-green-400">Generated {state.generated} items.</p> : null}
    </form>
  );
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` — exit 0.
- [ ] **Step 3: Commit** — `git commit -m "feat(m4b): generate-button client component (Task 3)"`

---

### Task 4: Materials page (RSC list) + nav link

**Files:** Create `src/app/materials/page.tsx`, Modify `src/app/layout.tsx`

- [ ] **Step 1: Add the nav link** — in `src/app/layout.tsx`, add `{ href: "/materials", label: "Materials" }` to the `NAV` array (between Today and Import).

- [ ] **Step 2: Implement the materials page**

```tsx
// src/app/materials/page.tsx
import Link from "next/link";
import { appContext } from "../../lib/server/context";
import { getActiveThesis, getPrepItems, type PrepItemRow } from "../../db/repository";
import { GenerateButton } from "./generate-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  verified: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  needs_review: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  unsafe: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export default async function MaterialsPage() {
  const { db } = await appContext();
  const thesis = getActiveThesis(db);

  if (!thesis) {
    return (
      <section className="flex flex-col items-start gap-4">
        <h2 className="text-2xl font-semibold">Materials</h2>
        <p className="text-zinc-600 dark:text-zinc-400">Import a thesis first to generate a prep pack.</p>
        <Link href="/import" className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">
          Import a thesis
        </Link>
      </section>
    );
  }

  const items = getPrepItems(db, thesis.id);
  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Materials</h2>
          <p className="text-zinc-600 dark:text-zinc-400">{thesis.title}</p>
        </div>
        <GenerateButton />
      </div>

      {items.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">No prep items yet. Generate a prep pack to get started.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((it) => (
            <PrepItemCard key={it.id} item={it} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PrepItemCard({ item }: { item: PrepItemRow }) {
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{item.type.replace("_", " ")}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[item.status] ?? STATUS_BADGE.draft}`}>
          {item.status.replace("_", " ")}
        </span>
      </div>
      <h3 className="mt-1 font-medium">{item.title}</h3>
      {item.claimText ? <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{item.claimText}</p> : null}
    </li>
  );
}
```

- [ ] **Step 3: Typecheck + build** — `npx tsc --noEmit` (exit 0). (Claude runs `npm run build`.)
- [ ] **Step 4: Commit** — `git commit -m "feat(m4b): materials page (prep-item list + badges) + nav link (Task 4)"`

---

## Full-suite gate + manual smoke (Claude runs; Codex cannot run npm/next)

```bash
npm run check   # typecheck + lint + vitest (incl. getPrepItems test)
npm run build   # Next prod build green (/materials Dynamic)
```
Then a **manual dev smoke** (Claude, AI off): import a small Markdown thesis → `/materials` shows "No prep items yet" + a Generate button → click Generate → friendly "AI is disabled…" message (graceful degrade, no crash). Then inject a done `prep_pack` `generation_run` + a couple of `prep_item` rows tied to that `generation_run_id` (verified + needs_review) and reload `/materials` → both render with correct badges (items from an older or 'error' run, if injected, must NOT appear). Confirm `/materials` with **no active thesis** shows the import prompt.

Expected: gate green; test count = previous (138) + Task 1 (2) = 140 + 2 skipped. Typed casts in tests, never `as any`.

## Red-line / safety checklist

1. **Graceful degrade (red line #4):** the action checks `config.effectiveAiEnabled && config.gatewayConfigured` (mirroring `getLlmClient`) and returns a friendly message with NO model call when AI is off; `/materials` itself renders fully without AI (list + empty states). The app never crashes for a key-less user.
2. **AI only via `lib/llm` (red line #2):** generation goes through `appLlmClient` → `getLlmClient` → M2 `runPrepPackGeneration`. No provider SDK, no model name in the action.
3. **Evidence-binding + validator gate intact (red line #1):** M4b reuses `runPrepPackGeneration` unchanged — items are still evidence-bound and only deterministically-provable ones reach `verified`. The badge just reflects the persisted `status`; the UI cannot mark anything verified.
4. **DB only via the bridge:** `getPrepItems` is called with the `db` from `appContext()`; `/materials` sets `runtime="nodejs"` + `dynamic="force-dynamic"`.
5. **No secret leakage:** the client `GenerateButton` imports only the server-action reference + react; no db/config/server-only module enters the client bundle.

## Self-review

- **Spec coverage:** §7 ② generate (generation_run-driven prep_item creation, surfaced as a button) → Tasks 2–4; §7 ④ materials (read the generated pack with status) → Tasks 1,4. Edit→re-validate and per-type regenerate are explicitly deferred (scope note).
- **Type consistency:** `PrepItemRow` is shared by `getPrepItems` and the page; `GenerateState` by the action and the button; `runPrepPackGeneration(db, client, thesisId)` matches its M2 signature (returns `itemCount`).
- **Testable surface:** Task 1 (getPrepItems) is unit-tested; Tasks 2–4 (action/button/page) are typecheck + build + manual smoke — the generation core is M2-unit-tested, the AI-off branch is smoke-verified.
- **No placeholders:** full code for every file.
- **Resolved in round 1:** `getPrepItems` filters to the latest **done** `prep_pack` run (de-dups re-generates + hides errored-run partials); the generate guard mirrors `getLlmClient`'s `effectiveAiEnabled && gatewayConfigured` gate; `appContext()` is awaited (it is async). The page reads mutable DB state so it stays `dynamic="force-dynamic"`.
