# Polish P1 — Switch between imported theses

> **老流程:** Codex implements per task; Claude runs the gate + reviews + commits, with a Codex design review before code and a milestone gate after. (Polish item — tight scope, one design-review round expected.)

**Goal:** The app keeps every imported thesis (re-importing only deactivates the prior one). Let the user see all imported theses on `/library` and make any past one active again — without re-importing.

**Architecture:** Two repository helpers (`listTheses`, `switchActiveThesis` — transactional, preserves the single-active invariant) + a Server-Action form on the library page. Pure reads + a single is_active flip; no AI, no content change.

**Tech Stack:** better-sqlite3, Next 16 RSC + a server-component `<form action={...}>`, Tailwind, vitest.

> **Scope:** switch only (no rename/delete — deleting a thesis CASCADEs its prep/practice/recordings, a riskier action deferred). The active thesis drives every page, so the action revalidates the whole app.

---

## Contracts

```ts
// src/db/repository.ts
export type ThesisListItem = { id: string; title: string; author: string | null; sourceKind: "pdf" | "md" | "txt"; createdAt: string; isActive: boolean };
export function listTheses(db: DB): ThesisListItem[];
export function switchActiveThesis(db: DB, thesisId: string): void; // throws if the id doesn't exist

// src/app/_actions/thesis.ts (existing file) — add
export async function switchThesisAction(formData: FormData): Promise<void>;
```

## File structure

- **Modify** `src/db/repository.ts` (+`src/db/repository.thesis-list.test.ts`) — `listTheses` + `switchActiveThesis`.
- **Modify** `src/app/_actions/thesis.ts` — `switchThesisAction`.
- **Modify** `src/app/library/page.tsx` — a "Your theses" panel.

---

### Task 1: `listTheses` + `switchActiveThesis`

**Files:** Modify `src/db/repository.ts`, Create `src/db/repository.thesis-list.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/db/repository.thesis-list.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { listTheses, switchActiveThesis } from "./repository";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,author,source_kind,is_active,created_at) VALUES ('t0','Old','A','pdf',0,'2026-06-01T00:00:00Z');
    INSERT INTO thesis (id,title,author,source_kind,is_active,created_at) VALUES ('t1','Current','B','md',1,'2026-06-02T00:00:00Z');
  `);
}

describe("thesis list + switch", () => {
  it("listTheses returns all theses newest-first with the active one flagged", () => {
    const db = makeTestDb(); seed(db);
    const all = listTheses(db);
    expect(all.map((t) => t.id)).toEqual(["t1", "t0"]); // created_at DESC
    expect(all.find((t) => t.id === "t1")).toMatchObject({ title: "Current", author: "B", sourceKind: "md", isActive: true });
    expect(all.find((t) => t.id === "t0")!.isActive).toBe(false);
    db.close();
  });

  it("switchActiveThesis flips the active thesis (single-active preserved)", () => {
    const db = makeTestDb(); seed(db);
    switchActiveThesis(db, "t0");
    expect((db.prepare("SELECT id FROM thesis WHERE is_active=1").get() as { id: string }).id).toBe("t0");
    expect((db.prepare("SELECT count(*) c FROM thesis WHERE is_active=1").get() as { c: number }).c).toBe(1);
    db.close();
  });

  it("switchActiveThesis throws for an unknown id (no change)", () => {
    const db = makeTestDb(); seed(db);
    expect(() => switchActiveThesis(db, "nope")).toThrow();
    expect((db.prepare("SELECT id FROM thesis WHERE is_active=1").get() as { id: string }).id).toBe("t1");
    db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — append to `src/db/repository.ts`:

```ts
export type ThesisListItem = { id: string; title: string; author: string | null; sourceKind: "pdf" | "md" | "txt"; createdAt: string; isActive: boolean };

export function listTheses(db: DB): ThesisListItem[] {
  const rows = db
    .prepare("SELECT id, title, author, source_kind, created_at, is_active FROM thesis ORDER BY created_at DESC, rowid DESC")
    .all() as { id: string; title: string; author: string | null; source_kind: "pdf" | "md" | "txt"; created_at: string; is_active: number }[];
  return rows.map((r) => ({ id: r.id, title: r.title, author: r.author, sourceKind: r.source_kind, createdAt: r.created_at, isActive: r.is_active === 1 }));
}

export function switchActiveThesis(db: DB, thesisId: string): void {
  if (!db.prepare("SELECT 1 FROM thesis WHERE id=?").get(thesisId)) throw new Error(`thesis not found: ${thesisId}`);
  const tx = db.transaction(() => {
    db.prepare("UPDATE thesis SET is_active=0 WHERE is_active=1").run();           // clear first → no partial-unique clash
    db.prepare("UPDATE thesis SET is_active=1 WHERE id=?").run(thesisId);          // only the is_active flag flips (matches the import deactivate pattern)
  });
  tx();
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (3).
- [ ] **Step 5: Commit** — `git commit -m "feat(p1): listTheses + switchActiveThesis repository helpers"`

---

### Task 2: `switchThesisAction` + library "Your theses" panel

**Files:** Modify `src/app/_actions/thesis.ts`, `src/app/library/page.tsx`

- [ ] **Step 1: Add the action** — append to `src/app/_actions/thesis.ts`:

```ts
import { switchActiveThesis } from "../../db/repository"; // add to the existing repository import
// ...
export async function switchThesisAction(formData: FormData): Promise<void> {
  const { db } = await appContext();        // appContext is async (matches importThesisAction)
  const id = String(formData.get("thesisId") ?? "");
  try {
    if (id) switchActiveThesis(db, id);
  } catch {
    // unknown/forged/stale id → no-op; the active thesis is unchanged (don't 500)
  }
  revalidatePath("/", "layout");            // the active thesis drives every page
  redirect("/library");                     // OUTSIDE the try — redirect() throws NEXT_REDIRECT
}
```

> Match `importThesisAction`'s `appContext()` shape (it is `async` — `const { db } = await appContext();`). `revalidatePath`/`redirect` are already imported in this file. The `try/catch` makes a forged/stale id a no-op (no 500); `redirect` stays outside it so its control-flow signal isn't swallowed.

- [ ] **Step 2: Add the panel** — in `src/app/library/page.tsx`, import `listTheses` + `switchThesisAction`, and add a Panel after "Active thesis":

```tsx
// imports: add listTheses to the repository import; import { switchThesisAction } from "../_actions/thesis";

<Panel title="Your theses">
  <ul className="flex flex-col gap-2 text-sm">
    {listTheses(db).map((t) => (
      <li key={t.id} className="flex items-center justify-between gap-3">
        <span>
          <span className="font-medium">{t.title}</span>
          <span className="text-zinc-500"> · {t.sourceKind.toUpperCase()} · {t.createdAt.slice(0, 10)}</span>
        </span>
        {t.isActive ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">Active</span>
        ) : (
          <form action={switchThesisAction}>
            <input type="hidden" name="thesisId" value={t.id} />
            <button type="submit" className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Make active</button>
          </form>
        )}
      </li>
    ))}
  </ul>
</Panel>
```

> `/library` already has `runtime="nodejs"` + `dynamic="force-dynamic"`. The form is a plain server-component `<form action={serverAction}>` (no `"use client"`).

- [ ] **Step 3: Typecheck + build** — `npx tsc --noEmit` (exit 0). (Claude runs `npm run build`.)
- [ ] **Step 4: Commit** — `git commit -m "feat(p1): switchThesisAction + library 'your theses' panel"`

---

## Gate + smoke (Claude)

```bash
npm run check   # + the 3 list/switch tests
npm run build   # /library still Dynamic
```
Dev smoke (AI off): import thesis A, import thesis B (B active) → `/library` "Your theses" lists B (Active) + A (Make active) → click "Make active" on A → A becomes active, the rest of the app (home, materials…) now reflects A.

## Red lines

1. **Single-active invariant preserved:** `switchActiveThesis` clears the current active before setting the new one, inside a transaction — the `idx_thesis_one_active` partial-unique index can never be violated.
2. **No content change / no AI / local-first:** only the `is_active` flag flips; prep/practice/review/recordings are untouched; nothing leaves the machine.
3. **No client component / no secret leak:** the panel is a server-component form posting only the thesis id.

## Self-review

- **Scope:** switch only; rename/delete deferred (delete CASCADEs prep/practice/recordings — riskier, needs a confirm). `listTheses` orders by created_at DESC then rowid (deterministic for same-second imports).
- **Type consistency:** `ThesisListItem.sourceKind` matches the `source_kind` CHECK; `switchThesisAction` mirrors `importThesisAction`'s `await appContext()` shape + `revalidatePath("/","layout")` so every active-thesis-driven page refreshes.
- **Testable surface:** Task 1 (both helpers) unit-tested; Task 2 (action/panel) is typecheck + build + dev smoke.
- **Open question for Codex review:** is `revalidatePath("/", "layout")` the right call to refresh all active-thesis-driven routes after a switch, or should specific paths be listed?
