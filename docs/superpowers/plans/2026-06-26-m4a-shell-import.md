# M4a — App Shell + Server-Action Bridge + Thesis Import Implementation Plan

> **For agentic workers:** This project runs the Claude↔Codex 老流程 (see `AGENTS.md`): **Codex implements** each task via `codex:codex-rescue` (`--write`); **Claude runs tests + reviews + commits** per task and at a milestone gate (绿测试≠Done). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the headless M0–M3 backend into a running app: a nav shell, a server-side bridge that wires `config → db → LlmClient` for Server Actions, and the **import flow (spec §7 ①)** — paste MD/TXT or upload a PDF + title → `ingestThesis` → land on a home/"today" page that shows the active thesis. Works fully **without AI** (red line #4).

**Architecture:** Next.js App Router. Server Components read the DB directly through a server-only bridge (`lib/server/context`); mutations go through Server Actions (`"use server"`). The bridge is the ONLY place pages/actions construct `db`/`LlmClient`. The import form is a small client component using React 19 `useActionState` so validation/quality errors render inline.

**Tech Stack:** Next 16 App Router (RSC + Server Actions), React 19 (`useActionState`), Tailwind v4 (CSS-config, no component lib), better-sqlite3 (Node runtime), vitest. DB only via the bridge; AI only via `lib/llm`; evidence-binding untouched (reuses `ingestThesis`).

> **Revised after Codex design-review round 1** (CONDITIONAL GO → fixes integrated):
> - **P0 (Task 3, new):** `getDb` never ran migrations (only `makeTestDb` did) → a fresh real DB crashes "no such table". Fix: `getDb` runs `runMigrations` on singleton creation.
> - **P1 (Task 4, new):** the quality gate fired *after* `ingestThesis` already persisted + (via `insertThesisWithChunks`) deactivated the prior active thesis. Fix: `ingestThesis` throws `IngestQualityError` BEFORE persisting when `!report.ok`; a test proves a bad import neither persists nor displaces the active thesis.
> - **P1 (Task 6):** `runtime="nodejs"` does not disable RSC caching → `/` could serve a stale static render. Fix: `export const dynamic = "force-dynamic"` on `/` + `revalidatePath("/")` before `redirect("/")` in the action.
> - **P2:** the two risky paths (migration-on-fresh-db, quality-gate) now have unit tests; the full flow is covered by the manual dev smoke. Automated e2e (Playwright) deferred — not yet set up.

> **M4 is decomposed** (writing-plans scope-check: §7 is 7 screens): **M4a = shell + bridge + import + home** (this plan) → M4b generate + materials → M4c practice + judge + review → M4d today/library/settings.

---

## Contracts

```ts
// src/lib/import/parse.ts — pure
import type { IngestInput } from "../ingest";
export type RawImport = { title: string; sourceKind: string; content?: string; data?: Uint8Array };
export function parseImportForm(raw: RawImport): IngestInput; // throws Error(friendly) on bad input

// src/lib/ingest/index.ts — NEW typed error; ingestThesis now gates on quality before persisting
export class IngestQualityError extends Error { readonly report: QualityReport; }

// src/db/repository.ts
export type ActiveThesis = { id: string; title: string; author: string | null; sourceKind: "pdf" | "md" | "txt"; createdAt: string };
export function getActiveThesis(db: DB): ActiveThesis | undefined;

// src/lib/server/context.ts — server-only
export function appContext(): { db: DB; config: Config };
export async function appLlmClient(ctx: { db: DB; config: Config }): Promise<LlmClient>;
```

## File structure

- **Create** `src/lib/import/parse.ts` (+test) — form→IngestInput validation.
- **Modify** `src/db/repository.ts` (+`src/db/repository.thesis-read.test.ts`) — `getActiveThesis`.
- **Modify** `src/db/client.ts` (+`src/db/client.test.ts`) — `getDb` runs migrations on creation.
- **Modify** `src/lib/ingest/index.ts` (+ update `src/lib/ingest/index.test.ts`) — `IngestQualityError`, gate before persist.
- **Create** `src/lib/server/context.ts` — bridge.
- **Create** `src/app/_actions/thesis.ts` — `importThesisAction`.
- **Modify** `src/app/layout.tsx`, `src/app/page.tsx`; **Create** `src/app/import/page.tsx`, `src/app/import/import-form.tsx`.

---

### Task 1: `parseImportForm` (pure validation)

**Files:** Create `src/lib/import/parse.ts`, `src/lib/import/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/import/parse.test.ts
import { describe, it, expect } from "vitest";
import { parseImportForm } from "./parse";

describe("parseImportForm", () => {
  it("builds an md/txt IngestInput from pasted content (trimmed title)", () => {
    expect(parseImportForm({ title: "  My Thesis ", sourceKind: "md", content: "# Hello\n\npara" })).toEqual({
      title: "My Thesis", sourceKind: "md", content: "# Hello\n\npara",
    });
  });
  it("builds a pdf IngestInput from bytes", () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(parseImportForm({ title: "T", sourceKind: "pdf", data })).toEqual({ title: "T", sourceKind: "pdf", data });
  });
  it("rejects an empty title", () => {
    expect(() => parseImportForm({ title: "   ", sourceKind: "md", content: "x" })).toThrow(/title/i);
  });
  it("rejects md/txt with no content", () => {
    expect(() => parseImportForm({ title: "T", sourceKind: "txt", content: "   " })).toThrow(/text|content/i);
  });
  it("rejects pdf with no/empty data", () => {
    expect(() => parseImportForm({ title: "T", sourceKind: "pdf", data: new Uint8Array() })).toThrow(/pdf|file/i);
  });
  it("rejects an unsupported source kind", () => {
    expect(() => parseImportForm({ title: "T", sourceKind: "docx", content: "x" })).toThrow(/source/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/import/parse.test.ts` — FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/import/parse.ts
import type { IngestInput } from "../ingest";

export type RawImport = { title: string; sourceKind: string; content?: string; data?: Uint8Array };

export function parseImportForm(raw: RawImport): IngestInput {
  const title = raw.title.trim();
  if (!title) throw new Error("Please enter a title.");
  if (raw.sourceKind === "md" || raw.sourceKind === "txt") {
    const content = (raw.content ?? "").trim();
    if (!content) throw new Error("Please paste some text or Markdown.");
    return { title, sourceKind: raw.sourceKind, content };
  }
  if (raw.sourceKind === "pdf") {
    if (!raw.data || raw.data.byteLength === 0) throw new Error("Please choose a PDF file.");
    return { title, sourceKind: "pdf", data: raw.data };
  }
  throw new Error(`Unsupported source kind: ${raw.sourceKind}`);
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (6).
- [ ] **Step 5: Commit** — `git commit -m "feat(m4a): parseImportForm (form -> IngestInput validation) (Task 1)"`

---

### Task 2: `getActiveThesis` repository helper

**Files:** Modify `src/db/repository.ts`, Create `src/db/repository.thesis-read.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/db/repository.thesis-read.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { getActiveThesis } from "./repository";

describe("getActiveThesis", () => {
  it("returns undefined when there is no thesis", () => {
    const db = makeTestDb();
    expect(getActiveThesis(db)).toBeUndefined();
    db.close();
  });
  it("returns the active thesis only", () => {
    const db = makeTestDb();
    db.exec(`
      INSERT INTO thesis (id,title,author,source_kind,is_active) VALUES ('t0','Old','A','pdf',0);
      INSERT INTO thesis (id,title,author,source_kind,is_active) VALUES ('t1','Active','B','md',1);
    `);
    expect(getActiveThesis(db)).toMatchObject({ id: "t1", title: "Active", author: "B", sourceKind: "md" });
    db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — append to `src/db/repository.ts`:

```ts
export type ActiveThesis = { id: string; title: string; author: string | null; sourceKind: "pdf" | "md" | "txt"; createdAt: string };

export function getActiveThesis(db: DB): ActiveThesis | undefined {
  const row = db
    .prepare("SELECT id, title, author, source_kind, created_at FROM thesis WHERE is_active=1")
    .get() as { id: string; title: string; author: string | null; source_kind: "pdf" | "md" | "txt"; created_at: string } | undefined;
  if (!row) return undefined;
  return { id: row.id, title: row.title, author: row.author, sourceKind: row.source_kind, createdAt: row.created_at };
}
```

- [ ] **Step 4: Run to verify it passes** — PASS (2).
- [ ] **Step 5: Commit** — `git commit -m "feat(m4a): getActiveThesis repository helper (Task 2)"`

---

### Task 3: `getDb` runs migrations on creation (P0 — fresh DB must not crash)

**Files:** Modify `src/db/client.ts`, Create `src/db/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/db/client.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { getDb } from "./client";

const g = globalThis as unknown as { __dVivaAssistantAgentDb?: import("better-sqlite3").Database };
afterEach(() => { g.__dVivaAssistantAgentDb?.close?.(); delete g.__dVivaAssistantAgentDb; });

describe("getDb", () => {
  it("runs migrations on first creation (schema is queryable, not 'no such table')", () => {
    delete g.__dVivaAssistantAgentDb;
    const db = getDb(":memory:");
    expect(() => db.prepare("SELECT count(*) FROM thesis").get()).not.toThrow();
    expect(() => db.prepare("SELECT count(*) FROM prep_item").get()).not.toThrow();
  });
  it("returns the same singleton on repeated calls", () => {
    delete g.__dVivaAssistantAgentDb;
    expect(getDb(":memory:")).toBe(getDb(":memory:"));
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/db/client.test.ts` — FAIL ("no such table: thesis").

- [ ] **Step 3: Implement** — modify `src/db/client.ts`:

```ts
import "server-only";
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { runMigrations } from "./migrate";

export function createDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

// HMR-safe singleton: reuse the connection across dev reloads.
const g = globalThis as unknown as { __dVivaAssistantAgentDb?: DB };

export function getDb(path: string): DB {
  if (!g.__dVivaAssistantAgentDb) {
    const db = createDb(path);
    runMigrations(db); // idempotent (schema_migrations); the singleton's first opener migrates
    g.__dVivaAssistantAgentDb = db;
  }
  return g.__dVivaAssistantAgentDb;
}
```

> `makeTestDb` keeps calling `createDb` + `runMigrations` itself, so this change does not affect existing tests. `createDb` stays migration-free (used where the caller controls migration).

- [ ] **Step 4: Run to verify it passes** — PASS (2).
- [ ] **Step 5: Commit** — `git commit -m "fix(m4a): getDb runs migrations on creation so a fresh DB is usable (Task 3)"`

---

### Task 4: `ingestThesis` enforces the quality gate before persisting (P1)

**Files:** Modify `src/lib/ingest/index.ts`, update `src/lib/ingest/index.test.ts`

Today `ingestThesis` extracts → chunks → `insertThesisWithChunks` (which deactivates the prior active thesis) → returns `report`, so a low-quality import already replaced the active thesis before the caller can react. Make quality a real gate: throw BEFORE persisting.

- [ ] **Step 1: Update/replace the M1 quality test**

In `src/lib/ingest/index.test.ts`, the existing test "still ingests but flags a poor (too-short) source as not ok" asserted the old (persist-anyway) behavior. Replace it with:

```ts
import { ingestThesis, IngestQualityError } from "./index";
// ... existing good-path test unchanged ...

it("throws IngestQualityError on a too-short source and persists nothing, leaving the active thesis intact", async () => {
  const db = makeTestDb();
  // a good thesis is active first — 3 body paragraphs, ~340 chars (passes paragraphs>=3 && chars>=200)
  const goodMd = [
    "This thesis investigates voice emotion recognition using deep neural networks trained on a large speech corpus.",
    "The methodology combines spectral features with a transformer encoder, evaluated against several established baselines.",
    "Results show an overall accuracy of 81.3 percent, with detailed error analysis across the five target emotion classes.",
  ].join("\n\n");
  await ingestThesis(db, { title: "Good", sourceKind: "md", content: goodMd });
  // a bad import must NOT persist or displace the active thesis
  await expect(ingestThesis(db, { title: "Bad", sourceKind: "txt", content: "too short" })).rejects.toBeInstanceOf(IngestQualityError);
  const active = db.prepare("SELECT title FROM thesis WHERE is_active=1").get() as { title: string };
  expect(active.title).toBe("Good");
  expect((db.prepare("SELECT count(*) c FROM thesis").get() as { c: number }).c).toBe(1);
  db.close();
});
```

> The `goodMd` fixture is concretely sized to pass M1's gate (`paragraphs >= 3 && chars >= 200`, see `extract.ts` `buildReport`): exactly 3 body paragraphs (no heading lines, which parse as sections not paragraphs), ~340 chars. The bad import (`"too short"`) is 1 short paragraph → `ok=false` → throws. Do NOT use a fixture with `<3` body paragraphs — it would fail the gate and break the setup.

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/ingest/index.test.ts` — FAIL (`IngestQualityError` not exported; bad import currently resolves).

- [ ] **Step 3: Implement** — modify `src/lib/ingest/index.ts`:

```ts
export class IngestQualityError extends Error {
  constructor(public readonly report: QualityReport) {
    super(`Import quality too low: ${report.paragraphs} paragraphs, ${report.chars} chars`);
    this.name = "IngestQualityError";
  }
}

export async function ingestThesis(db: DB, input: IngestInput): Promise<{ thesisId: string; report: QualityReport }> {
  const extracted =
    input.sourceKind === "pdf" ? await extractPdf(input.data)
    : input.sourceKind === "md" ? extractMarkdown(input.content)
    : extractText(input.content);

  if (!extracted.report.ok) throw new IngestQualityError(extracted.report); // gate BEFORE any persist

  const chunks = chunkParagraphs(extracted.paragraphs);
  const thesisId = randomUUID();
  insertThesisWithChunks(db, {
    thesis: { id: thesisId, title: input.title, author: input.author, source_kind: input.sourceKind as SourceKind },
    chunks,
  });
  return { thesisId, report: extracted.report };
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/ingest/index.test.ts` — PASS.
- [ ] **Step 5: Commit** — `git commit -m "fix(m4a): ingestThesis gates on quality before persisting (no displacing active thesis) (Task 4)"`

---

### Task 5: Server-action bridge + `importThesisAction`

**Files:** Create `src/lib/server/context.ts`, `src/app/_actions/thesis.ts`

The bridge is thin wiring over already-tested `loadConfig`/`getDb`/`getLlmClient`; it is exercised by the build + manual smoke. The validation + gate it relies on are unit-tested (Tasks 1, 4).

- [ ] **Step 1: Implement the bridge**

```ts
// src/lib/server/context.ts
import "server-only";
import type { Database as DB } from "better-sqlite3";
import { loadConfig, type Config } from "../config";
import { getDb } from "../../db/client";
import { getLlmClient } from "../llm";
import type { LlmClient } from "../llm/types";

/** The ONLY place a page/action constructs db+config. getDb migrates on first open. */
export function appContext(): { db: DB; config: Config } {
  const config = loadConfig(process.env);
  return { db: getDb(config.dbPath), config };
}

export async function appLlmClient(ctx: { db: DB; config: Config }): Promise<LlmClient> {
  return getLlmClient(ctx.db, {
    effectiveAiEnabled: ctx.config.effectiveAiEnabled,
    gatewayConfigured: ctx.config.gatewayConfigured,
  });
}
```

- [ ] **Step 2: Implement the import action**

```ts
// src/app/_actions/thesis.ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { appContext } from "../../lib/server/context";
import { parseImportForm } from "../../lib/import/parse";
import { ingestThesis, IngestQualityError } from "../../lib/ingest";

export type ImportState = { error: string | null };

export async function importThesisAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  let input;
  try {
    const sourceKind = String(formData.get("sourceKind") ?? "");
    const title = String(formData.get("title") ?? "");
    let data: Uint8Array | undefined;
    if (sourceKind === "pdf") {
      const file = formData.get("file");
      if (file instanceof File && file.size > 0) data = new Uint8Array(await file.arrayBuffer());
    }
    input = parseImportForm({ title, sourceKind, content: String(formData.get("content") ?? ""), data });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid input." };
  }

  try {
    const { db } = appContext();
    await ingestThesis(db, input);
  } catch (e) {
    if (e instanceof IngestQualityError) {
      return { error: `Import quality too low (${e.report.paragraphs} paragraphs, ${e.report.chars} chars). Try pasting cleaner Markdown/text.` };
    }
    return { error: e instanceof Error ? e.message : "Import failed." };
  }

  revalidatePath("/");
  redirect("/"); // throws NEXT_REDIRECT — MUST be outside the try/catch above
}
```

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` — exit 0.
- [ ] **Step 4: Commit** — `git commit -m "feat(m4a): server-action bridge + importThesisAction (Task 5)"`

---

### Task 6: App shell (layout + nav) + home/today page

**Files:** Modify `src/app/layout.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Implement the shell**

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "D-viva-assistant-agent", description: "Thesis defence prep" };

const NAV = [
  { href: "/", label: "Today" },
  { href: "/import", label: "Import" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col">
          <header className="flex items-center gap-6 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
            <span className="text-lg font-semibold">D-viva-assistant-agent</span>
            <nav className="flex gap-4 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                  {n.label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="flex-1 px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Implement the home/today page**

```tsx
// src/app/page.tsx
import Link from "next/link";
import { appContext } from "../lib/server/context";
import { getActiveThesis, countEvidence, getThesisChunks } from "../db/repository";

export const runtime = "nodejs"; // touches better-sqlite3
export const dynamic = "force-dynamic"; // reads mutable DB state — never statically cache

export default function Home() {
  const { db } = appContext();
  const thesis = getActiveThesis(db);

  if (!thesis) {
    return (
      <section className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold">No thesis yet</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Import a thesis to start preparing for your viva.</p>
        <Link href="/import" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          Import a thesis
        </Link>
      </section>
    );
  }

  const evidence = countEvidence(db, thesis.id);
  const chunks = getThesisChunks(db, thesis.id).length;
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{thesis.title}</h1>
        {thesis.author && <p className="text-zinc-600 dark:text-zinc-400">{thesis.author}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Source" value={thesis.sourceKind.toUpperCase()} />
        <Stat label="Chunks" value={String(chunks)} />
        <Stat label="Evidence units" value={String(evidence)} />
      </dl>
      <Link href="/import" className="text-sm text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400">
        Import a different thesis
      </Link>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-1 text-xl font-semibold">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` — exit 0.
- [ ] **Step 4: Commit** — `git commit -m "feat(m4a): app shell (nav) + home/today active-thesis view (force-dynamic) (Task 6)"`

---

### Task 7: Import route + client form

**Files:** Create `src/app/import/page.tsx`, `src/app/import/import-form.tsx`

- [ ] **Step 1: Implement the page (server component)**

```tsx
// src/app/import/page.tsx
import { ImportForm } from "./import-form";

export const runtime = "nodejs"; // the action touches better-sqlite3

export default function ImportPage() {
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Import a thesis</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Paste Markdown/text or upload a PDF. Importing replaces the current active thesis.</p>
      </div>
      <ImportForm />
    </section>
  );
}
```

- [ ] **Step 2: Implement the client form**

```tsx
// src/app/import/import-form.tsx
"use client";
import { useActionState, useState } from "react";
import { importThesisAction, type ImportState } from "../_actions/thesis";

const initial: ImportState = { error: null };

export function ImportForm() {
  const [state, action, pending] = useActionState(importThesisAction, initial);
  const [kind, setKind] = useState("md");

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Title</span>
        <input name="title" required className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Source</span>
        <select name="sourceKind" value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
          <option value="md">Markdown</option>
          <option value="txt">Plain text</option>
          <option value="pdf">PDF file</option>
        </select>
      </label>

      {kind === "pdf" ? (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">PDF file</span>
          <input type="file" name="file" accept="application/pdf" className="text-sm" />
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Content</span>
          <textarea name="content" rows={12} className="rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
      )}

      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      <button type="submit" disabled={pending} className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
        {pending ? "Importing…" : "Import"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Typecheck + build** — `npx tsc --noEmit` (exit 0).
- [ ] **Step 4: Commit** — `git commit -m "feat(m4a): import route + client form (useActionState) (Task 7)"`

---

## Full-suite gate + manual smoke (Claude runs; Codex cannot run npm/next)

```bash
npm run check   # typecheck + lint + vitest (all suites incl. parse, getActiveThesis, getDb-migrate, ingest-gate)
npm run build   # Next prod build — pages compile, server-only imports OK
```
Then a **manual dev smoke** (Claude): on a FRESH `data/` (delete any dev db first), `npm run dev` → `/` shows the empty state (no "no such table" crash → proves Task 3) → `/import`, paste a small Markdown thesis + title → Import → redirected to `/` showing title + chunk/evidence counts → re-import a second one → it replaces the first (single-active) → try a 2-line "bad" paste → inline quality error, and `/` still shows the previous thesis (proves Task 4). Confirm it all works with **no AI key**.

Expected: gate green; test count = previous (129) + Task 1 (6) + Task 2 (2) + Task 3 (2) + Task 4 (net change, ~same) ≈ 139 + 2 skipped. Typed casts in tests, never `as any`.

## Red-line / safety checklist

1. **Local-first, no AI required (red line #4):** M4a touches no model; the whole slice works with AI disabled. `appLlmClient` exists for later slices, unused here.
2. **DB only via the bridge:** every page/action gets `db` from `appContext()`; pages reading/writing DB set `runtime="nodejs"` and `/` sets `dynamic="force-dynamic"`. No page calls `getDb`/`new Database` directly.
3. **Evidence-binding intact:** import reuses `ingestThesis` (now quality-gated) → chunks + one evidence_unit per chunk + FTS triggers. No raw thesis writes from the UI.
4. **No silent data loss:** a low-quality import throws before persisting, so it never deactivates/replaces the existing active thesis (Task 4 test proves it).
5. **No secrets in client:** bridge + actions are server-only; the client form posts FormData only. No env/keys reach the browser.

## Self-review

- **Spec coverage:** §7 ① import (paste/upload + title → ingest → quality gate that *prevents* a bad import per "质量差 → 提示改用粘贴文本/Markdown") → Tasks 1,4,5,7; §5 app structure (App Router + Server Actions, runtime=nodejs at DB routes) → Tasks 5–7; first-run migration → Task 3; the active-thesis landing → Task 6.
- **Type consistency:** `parseImportForm` returns the `IngestInput` union; `getActiveThesis` maps `source_kind`→`sourceKind`; `ImportState` shared by action + form; `IngestQualityError.report` is `QualityReport`.
- **Testable surface:** Tasks 1–4 are unit-tested (incl. the two round-1 risk paths); Tasks 5–7 (bridge/action/pages) are typecheck + `next build` + manual smoke — inherent to RSC/Server-Action UI.
- **No placeholders:** full code for every file.
- **Resolved in round 1:** migrations-on-getDb (P0), quality-gate-before-persist (P1), force-dynamic + revalidatePath (P1), unit coverage for the risk paths (P2). Playwright e2e deferred (not set up) — noted, not silently dropped.
