# M4d — Today Dashboard + Library/Settings Implementation Plan

> **For agentic workers:** This project runs the Claude↔Codex 老流程 (see `AGENTS.md`): **Codex implements** each task via `codex:codex-rescue` (`--write`); **Claude runs tests + reviews + commits** per task and at a milestone gate (绿测试≠Done). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finish the M4 UI with the read-mostly pages (§7 ③⑦): upgrade `/` into a "today" dashboard (progress counts + a recommended next action), and add `/library` (active-thesis info + an AI-config **privacy disclosure** + a content-accuracy panel). No AI calls — pure reads + display.

**Architecture:** One repository read (`getThesisStats`) feeds both pages; one pure helper (`recommendNextAction`) decides the dashboard's call-to-action. The library page reads `config` from `appContext()` to disclose, in plain language, exactly what data is sent where (spec §3: "UI 明告会发什么给谁"). Everything renders with AI off.

**Tech Stack:** Next 16 App Router (RSC), Tailwind v4, better-sqlite3, vitest. DB only via `appContext`; no model calls anywhere in this slice.

> **M4 decomposition:** M4a shell+import ✓ → M4b generate+materials ✓ → M4c practice+judge+review ✓ → **M4d today + library/settings (this plan)** = M4 complete.
>
> **v1 scope notes (deferred):** thesis **switching** between past (inactive) theses is deferred (the app re-imports to replace; a thesis list + switch action comes later). Exact model-name display + the FTS/section evidence-coverage metric are deferred — the library shows AI on/off, gateway, STT, the privacy disclosure, and the prep-item accuracy breakdown. Prep counts are cumulative across generations (latest-run scoping is a later refinement, consistent with M4b's note).

> **Revised after Codex design-review round 1** (CONDITIONAL GO → fixes integrated): **P1** the privacy disclosure must be per-channel — "nothing leaves this machine" is false when `STT_PROVIDER` is `google_cloud` (audio → GCP) or `browser`. Fixed: AI and STT are disclosed separately (each STT mode — off/browser/google_cloud — described), and the "nothing leaves" line is shown only when AI is off AND STT is off. **P2** the accuracy panel now includes `prepDraft` (the schema's 4th status) so the breakdown is complete.

---

## Contracts

```ts
// src/db/repository.ts
export type ThesisStats = {
  evidenceUnits: number;
  prepTotal: number; prepVerified: number; prepNeedsReview: number; prepUnsafe: number; prepDraft: number;
  practiceRuns: number; openReviews: number;
};
export function getThesisStats(db: DB, thesisId: string): ThesisStats;

// src/lib/dashboard.ts — pure
export type NextAction = { label: string; href: string };
export function recommendNextAction(stats: { prepTotal: number; practiceRuns: number; openReviews: number }, aiReady: boolean): NextAction;
```

## File structure

- **Modify** `src/db/repository.ts` (+`src/db/repository.stats.test.ts`) — `getThesisStats`.
- **Create** `src/lib/dashboard.ts` (+`src/lib/dashboard.test.ts`) — pure `recommendNextAction`.
- **Modify** `src/app/page.tsx` — today dashboard (stats + recommended action).
- **Create** `src/app/library/page.tsx`; **Modify** `src/app/layout.tsx` — Library nav link.

---

### Task 1: `getThesisStats` + pure `recommendNextAction`

**Files:** Modify `src/db/repository.ts` (+`src/db/repository.stats.test.ts`), Create `src/lib/dashboard.ts` (+`src/lib/dashboard.test.ts`)

- [ ] **Step 1: Write the failing tests**

```ts
// src/db/repository.stats.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { getThesisStats } from "./repository";

describe("getThesisStats", () => {
  it("counts evidence, prep items by status, practice runs, and open reviews", () => {
    const db = makeTestDb();
    db.exec(`
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
      INSERT INTO thesis_chunk (id,thesis_id,ord,text,char_count,hash) VALUES ('c1','t1',0,'x',1,'h');
      INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash) VALUES ('e1','t1','c1',0,1,'x','h');
      INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash) VALUES ('e2','t1','c1',0,1,'y','h');
      INSERT INTO prep_item (id,thesis_id,type,title,status,validation_status,validator_version,source) VALUES ('p1','t1','qa','A','verified','passed','1','generated');
      INSERT INTO prep_item (id,thesis_id,type,title,status,validation_status,validator_version,source) VALUES ('p2','t1','qa','B','needs_review','needs_review','1','generated');
      INSERT INTO prep_item (id,thesis_id,type,title,status,validation_status,validator_version,source) VALUES ('p3','t1','qa','C','unsafe','failed','1','generated');
      INSERT INTO prep_item (id,thesis_id,type,title,status,validation_status,validator_version,source) VALUES ('p4','t1','qa','D','draft','needs_review','0','manual');
      INSERT INTO practice_run (id,thesis_id,question,question_kind,status) VALUES ('pr1','t1','Q','random','practice');
      INSERT INTO review_item (id,thesis_id,practice_run_id,dimension,score,status) VALUES ('ri1','t1','pr1','evidence',2,'open');
      INSERT INTO review_item (id,thesis_id,practice_run_id,dimension,score,status) VALUES ('ri2','t1','pr1','clarity',1,'fixed');
    `);
    expect(getThesisStats(db, "t1")).toEqual({
      evidenceUnits: 2, prepTotal: 4, prepVerified: 1, prepNeedsReview: 1, prepUnsafe: 1, prepDraft: 1, practiceRuns: 1, openReviews: 1,
    });
    db.close();
  });
  it("returns zeroes for a thesis with nothing", () => {
    const db = makeTestDb();
    db.exec(`INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);`);
    expect(getThesisStats(db, "t1")).toEqual({ evidenceUnits: 0, prepTotal: 0, prepVerified: 0, prepNeedsReview: 0, prepUnsafe: 0, prepDraft: 0, practiceRuns: 0, openReviews: 0 });
    db.close();
  });
});
```

```ts
// src/lib/dashboard.test.ts
import { describe, it, expect } from "vitest";
import { recommendNextAction } from "./dashboard";

describe("recommendNextAction", () => {
  it("with no prep items: generate (AI ready) or set up AI", () => {
    expect(recommendNextAction({ prepTotal: 0, practiceRuns: 0, openReviews: 0 }, true)).toEqual({ label: "Generate a prep pack", href: "/materials" });
    expect(recommendNextAction({ prepTotal: 0, practiceRuns: 0, openReviews: 0 }, false)).toEqual({ label: "Set up AI to generate a prep pack", href: "/library" });
  });
  it("prep but no practice → practise", () => {
    expect(recommendNextAction({ prepTotal: 5, practiceRuns: 0, openReviews: 0 }, true)).toEqual({ label: "Start practising", href: "/practice" });
  });
  it("open reviews → review with count + plural", () => {
    expect(recommendNextAction({ prepTotal: 5, practiceRuns: 2, openReviews: 1 }, true)).toEqual({ label: "Review 1 weak spot", href: "/review" });
    expect(recommendNextAction({ prepTotal: 5, practiceRuns: 2, openReviews: 3 }, true)).toEqual({ label: "Review 3 weak spots", href: "/review" });
  });
  it("all caught up → practise more", () => {
    expect(recommendNextAction({ prepTotal: 5, practiceRuns: 2, openReviews: 0 }, true)).toEqual({ label: "Practise another question", href: "/practice" });
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/db/repository.stats.test.ts src/lib/dashboard.test.ts` — FAIL (not exported).

- [ ] **Step 3: Implement**

Append to `src/db/repository.ts`:

```ts
export type ThesisStats = {
  evidenceUnits: number;
  prepTotal: number; prepVerified: number; prepNeedsReview: number; prepUnsafe: number; prepDraft: number;
  practiceRuns: number; openReviews: number;
};

export function getThesisStats(db: DB, thesisId: string): ThesisStats {
  const prepCount = (status: string) =>
    (db.prepare("SELECT count(*) c FROM prep_item WHERE thesis_id = ? AND status = ?").get(thesisId, status) as { c: number }).c;
  return {
    evidenceUnits: (db.prepare("SELECT count(*) c FROM evidence_unit WHERE thesis_id = ?").get(thesisId) as { c: number }).c,
    prepTotal: (db.prepare("SELECT count(*) c FROM prep_item WHERE thesis_id = ?").get(thesisId) as { c: number }).c,
    prepVerified: prepCount("verified"),
    prepNeedsReview: prepCount("needs_review"),
    prepUnsafe: prepCount("unsafe"),
    prepDraft: prepCount("draft"),
    practiceRuns: (db.prepare("SELECT count(*) c FROM practice_run WHERE thesis_id = ?").get(thesisId) as { c: number }).c,
    openReviews: (db.prepare("SELECT count(*) c FROM review_item WHERE thesis_id = ? AND status = 'open'").get(thesisId) as { c: number }).c,
  };
}
```

Create `src/lib/dashboard.ts`:

```ts
export type NextAction = { label: string; href: string };

export function recommendNextAction(
  stats: { prepTotal: number; practiceRuns: number; openReviews: number },
  aiReady: boolean,
): NextAction {
  if (stats.prepTotal === 0) {
    return aiReady
      ? { label: "Generate a prep pack", href: "/materials" }
      : { label: "Set up AI to generate a prep pack", href: "/library" };
  }
  if (stats.practiceRuns === 0) return { label: "Start practising", href: "/practice" };
  if (stats.openReviews > 0) return { label: `Review ${stats.openReviews} weak ${stats.openReviews === 1 ? "spot" : "spots"}`, href: "/review" };
  return { label: "Practise another question", href: "/practice" };
}
```

- [ ] **Step 4: Run to verify they pass** — PASS (2 + 4).
- [ ] **Step 5: Commit** — `git commit -m "feat(m4d): getThesisStats + recommendNextAction (Task 1)"`

---

### Task 2: Today dashboard (`/` upgrade)

**Files:** Modify `src/app/page.tsx`

Currently `/` shows the active thesis + Source/Chunks/Evidence. Add a prominent **recommended next action** + a progress grid. Keep the existing empty state + `runtime`/`dynamic` exports.

- [ ] **Step 1: Implement** — replace the active-thesis branch's body (keep the `if (!thesis)` empty state and the exports unchanged):

```tsx
// src/app/page.tsx
import Link from "next/link";
import { appContext } from "../lib/server/context";
import { getActiveThesis, getThesisStats } from "../db/repository";
import { recommendNextAction } from "../lib/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const { db, config } = await appContext();
  const thesis = getActiveThesis(db);

  if (!thesis) {
    return (
      <section className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold">No thesis yet</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Import a thesis to start preparing for your viva.</p>
        <Link href="/import" className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">Import a thesis</Link>
      </section>
    );
  }

  const stats = getThesisStats(db, thesis.id);
  const aiReady = config.effectiveAiEnabled && config.gatewayConfigured;
  const next = recommendNextAction(stats, aiReady);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{thesis.title}</h1>
        {thesis.author ? <p className="text-zinc-600 dark:text-zinc-400">{thesis.author}</p> : null}
      </div>

      <Link href={next.href} className="flex items-center justify-between rounded-lg bg-zinc-950 px-5 py-4 text-white dark:bg-zinc-50 dark:text-zinc-950">
        <span className="text-sm font-medium">Recommended next: {next.label}</span>
        <span aria-hidden>→</span>
      </Link>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Verified" value={stats.prepVerified} href="/materials" />
        <Stat label="Needs review" value={stats.prepNeedsReview} href="/materials" />
        <Stat label="Practice runs" value={stats.practiceRuns} href="/practice" />
        <Stat label="To review" value={stats.openReviews} href="/review" />
      </dl>

      <p className="text-sm text-zinc-500">
        {stats.evidenceUnits} evidence units · {stats.prepTotal} prep items · <Link href="/library" className="underline">library &amp; settings</Link>
      </p>
    </section>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </Link>
  );
}
```

- [ ] **Step 2: Typecheck + build** — `npx tsc --noEmit` (exit 0).
- [ ] **Step 3: Commit** — `git commit -m "feat(m4d): today dashboard (recommended next action + progress) (Task 2)"`

---

### Task 3: Library / settings page + nav

**Files:** Create `src/app/library/page.tsx`, Modify `src/app/layout.tsx`

- [ ] **Step 1: Add nav link** — in `src/app/layout.tsx`, append `{ href: "/library", label: "Library" }` to the `NAV` array (last).

- [ ] **Step 2: Implement the library page**

```tsx
// src/app/library/page.tsx
import Link from "next/link";
import { appContext } from "../../lib/server/context";
import { getActiveThesis, getThesisStats } from "../../db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const { db, config } = await appContext();
  const thesis = getActiveThesis(db);
  const aiReady = config.effectiveAiEnabled && config.gatewayConfigured;

  return (
    <section className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Library &amp; settings</h1>

      <Panel title="Active thesis">
        {thesis ? (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Field label="Title">{thesis.title}</Field>
            <Field label="Author">{thesis.author ?? "—"}</Field>
            <Field label="Source">{thesis.sourceKind.toUpperCase()}</Field>
            <Field label="Imported">{thesis.createdAt.slice(0, 10)}</Field>
          </dl>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No thesis imported. <Link href="/import" className="underline">Import one</Link>.</p>
        )}
      </Panel>

      <Panel title="AI &amp; privacy">
        <ul className="flex flex-col gap-2 text-sm">
          <li>
            <b>AI examiner / judge / prep generation:</b>{" "}
            {aiReady
              ? "enabled — generating a prep pack or scoring an answer sends the relevant thesis evidence text and your typed answer to your configured AI Gateway provider."
              : config.effectiveAiEnabled && !config.gatewayConfigured
                ? "off — a provider key is set but AI_GATEWAY_API_KEY is not, so nothing is sent."
                : "disabled — no thesis text or answers are sent anywhere."}
          </li>
          <li>
            <b>Speech-to-text:</b>{" "}
            {config.sttProvider === "off"
              ? "off — no audio is captured or sent."
              : config.sttProvider === "browser"
                ? "browser — audio is transcribed locally by your browser."
                : "Google Cloud — recorded audio is sent to Google Cloud Speech-to-Text for transcription."}
          </li>
        </ul>
        <p className="mt-3 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Your thesis, database, and recordings are always stored locally.
          {!aiReady && config.sttProvider === "off" ? " In this configuration, nothing leaves your machine." : ""}
        </p>
      </Panel>

      <Panel title="Content accuracy">
        {thesis ? <AccuracyPanel db={db} thesisId={thesis.id} /> : <p className="text-sm text-zinc-600 dark:text-zinc-400">Import a thesis to see accuracy stats.</p>}
      </Panel>
    </section>
  );
}

function AccuracyPanel({ db, thesisId }: { db: import("better-sqlite3").Database; thesisId: string }) {
  const s = getThesisStats(db, thesisId);
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Field label="Verified">{s.prepVerified}</Field>
        <Field label="Needs review">{s.prepNeedsReview}</Field>
        <Field label="Unsafe">{s.prepUnsafe}</Field>
        <Field label="Draft">{s.prepDraft}</Field>
      </dl>
      <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        Only prep items whose key facts are deterministically provable against their bound evidence are marked <b>verified</b>. Everything else stays <b>needs review</b> or <b>unsafe</b> — the app never presents an unverified claim as fact.
      </p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-zinc-500">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
```

> `AccuracyPanel` takes `db` typed as `import("better-sqlite3").Database` so the page (a server component) can pass the live connection without a client boundary issue (it never crosses to the client — `/library` is fully server-rendered). If that inline type is awkward, inline `getThesisStats` into the page body instead.

- [ ] **Step 3: Typecheck + build** — `npx tsc --noEmit` (exit 0). (Claude runs `npm run build`.)
- [ ] **Step 4: Commit** — `git commit -m "feat(m4d): library/settings page (thesis info + AI privacy + accuracy panel) (Task 3)"`

---

## Full-suite gate + manual smoke (Claude runs; Codex cannot run npm/next)

```bash
npm run check   # typecheck + lint + vitest (incl. getThesisStats + recommendNextAction)
npm run build   # Next prod build green (/ + /library Dynamic)
```
Then a **manual dev smoke** (Claude, AI off): with no thesis, `/` shows the import empty state and `/library` shows "No thesis imported". Import a thesis → `/` shows the recommended action (with AI off: "Set up AI to generate a prep pack" → /library) + the progress grid; `/library` shows the thesis info, AI **Disabled** + the privacy disclosure, and the accuracy panel (all zeroes). Inject a couple of prep_items (verified + unsafe) + an open review_item → `/` and `/library` reflect the counts and the recommendation updates.

Expected: gate green; test count = previous (144) + Task 1 (2 + 4) = 150 + 2 skipped. Typed casts in tests, never `as any`.

## Red-line / safety checklist

1. **No AI in this slice (red line #4):** M4d is pure reads + display; nothing is sent anywhere. The library page exists precisely to DISCLOSE the AI data flow (spec §3 明告) — it states plainly that data only leaves the machine when AI is enabled, and exactly what is sent.
2. **Validator gate honoured in the narrative (red line #1/#2):** the accuracy panel explains that only deterministically-provable items are `verified`; the UI reports counts, it never elevates status.
3. **DB only via the bridge:** both pages get `db`/`config` from `appContext()`; `runtime="nodejs"` + `dynamic="force-dynamic"`.
4. **No secrets shown:** the library discloses AI **enabled/disabled** and the STT provider — never the key values themselves; `config` carries booleans (`effectiveAiEnabled`, `gatewayConfigured`), not secrets.
5. **No client components added:** `/` and `/library` are fully server-rendered (no `"use client"`), so there is no client/secret-leak surface in this slice.

## Self-review

- **Spec coverage:** §7 ③ today (overview + recommended training) → Task 2; §7 ⑦ library/settings (thesis info, AI provider config + **明告**, content-accuracy panel P2-18) → Task 3. Thesis switching, model-name display, and FTS coverage metrics are deferred (scope note).
- **Type consistency:** `getThesisStats` returns `ThesisStats`; `recommendNextAction` takes a structural subset `{prepTotal,practiceRuns,openReviews}` (no `ThesisStats` import → no lib→db coupling); `aiReady = effectiveAiEnabled && gatewayConfigured` (mirrors `getLlmClient`, matching M4b/M4c).
- **Testable surface:** Task 1 (getThesisStats + recommendNextAction) fully unit-tested; Tasks 2–3 (pages) are typecheck + build + manual smoke — pure RSC reads, no actions.
- **No placeholders:** full code for every file.
- **Resolved in round 1:** the privacy disclosure is per-channel accurate (AI vs each STT mode; "nothing leaves" only when AI off AND STT off); the accuracy panel includes `prepDraft`. Codex confirmed passing the live `db` into the server-only `AccuracyPanel` is clean (both are RSCs, no client boundary) — kept as-is.
