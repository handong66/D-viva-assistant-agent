# M0 Foundation (M0a Skeleton + M0b Data/Evidence Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a building, lint-clean Next.js skeleton with a fully-tested SQLite data layer that enforces the spec's evidence-binding invariants (P0-2) and single-active-thesis rule.

**Architecture:** Next.js (App Router) app; all DB access is server-only through a single better-sqlite3 connection (WAL, HMR-safe singleton). Schema is created by a numbered SQL migration runner tracked in `schema_migrations`. Evidence binding is relational (join tables with composite PK + `ON DELETE CASCADE` + repository-enforced same-thesis invariant). FTS5 indexes evidence text via triggers.

**Tech Stack:** Next.js 16 + React 19 + TypeScript (strict) · better-sqlite3 · zod · vitest · ESLint · Tailwind.

**Scope:** M0a (scaffold, runtime/env/config, lint, build smoke) + M0b (DB client, migrations, full schema DDL, evidence join invariants, FTS5, repository basics). **Out of scope (next plans):** M0c LLM client/registry/mock/canary + leveled validator; M1 ingest; M2+ features.

**Spec:** `docs/superpowers/specs/2026-06-23-viva-assistant-generic-design.md` (§4 runtime boundaries, §6 data model, §14 env, §19 milestones).

---

## File Structure

- `package.json` / `next.config.ts` / `tsconfig.json` / `.eslintrc` — scaffold + config (Task 1–2, 8)
- `src/lib/config.ts` — zod-validated env/config; `getConfig()`, `effectiveAiEnabled` (Task 3)
- `src/lib/config.test.ts` — config tests (Task 3)
- `src/db/client.ts` — better-sqlite3 singleton (server-only, WAL, HMR guard) (Task 4)
- `src/db/migrate.ts` — migration runner + `schema_migrations` (Task 5)
- `src/db/migrations/0001_init.sql` — full schema DDL (Task 5)
- `src/db/migrate.test.ts` — migration/schema tests (Task 5)
- `src/db/fts.test.ts` — FTS5 availability + sync (Task 6)
- `src/db/repository.ts` — `replaceActiveThesis`, `bindPrepEvidence` (same-thesis guard) (Task 7)
- `src/db/repository.test.ts` — invariant tests (Task 7)
- `src/test/db.ts` — in-memory test DB helper (Task 5)

> Test DBs are in-memory (`:memory:`) so tests are deterministic and leave no files.

---

### Task 1: Scaffold Next.js in place (preserve git/docs/AGENTS)

**Files:**
- Create: app scaffold (`package.json`, `src/app/*`, `next.config.ts`, `tsconfig.json`, etc.)
- Preserve: `AGENTS.md`, `docs/`, `.git/`, merge `.gitignore`

- [ ] **Step 1: Move our non-scaffold files out so create-next-app sees a clean dir**

create-next-app refuses to scaffold into a dir containing files outside its allowlist (`docs/`, `AGENTS.md`). `.git` is allowlisted and stays. Run:
```bash
PRESERVE=$(mktemp -d) && echo "$PRESERVE" > .preserve-path
mv AGENTS.md docs .gitignore "$PRESERVE"/
```

- [ ] **Step 2: Scaffold into the current directory (non-interactive)**

Run:
```bash
npx --yes create-next-app@latest . --ts --tailwind --eslint --app --src-dir --use-npm --no-import-alias --yes
```
Expected: scaffold completes and `npm install` runs. Accept create-next-app defaults for any option not pinned by a flag (e.g. Turbopack).

- [ ] **Step 3: Restore preserved files and merge .gitignore**

Run:
```bash
PRESERVE=$(cat .preserve-path)
cp -R "$PRESERVE"/docs "$PRESERVE"/AGENTS.md ./
printf '\n# viva-assistant\n.env\n.env.local\n.env*.local\ndata/\n*.sqlite\n*.sqlite-shm\n*.sqlite-wal\nrecordings/\ncoverage/\n' >> .gitignore
rm -rf "$PRESERVE" .preserve-path
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: build succeeds (default Next welcome page compiles).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(m0a): scaffold Next.js app (TS, Tailwind, App Router, src dir)"
```

---

### Task 2: Configure runtime boundary + strict TS

**Files:**
- Modify: `next.config.ts`, `tsconfig.json`

- [ ] **Step 1: Set `serverExternalPackages` for better-sqlite3**

Replace `next.config.ts` with:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native Node module; keep it external to server bundles.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

- [ ] **Step 2: Tighten TS compiler options**

In `tsconfig.json` `compilerOptions`, ensure these are set:
```json
"strict": true,
"noUncheckedIndexedAccess": true,
"noImplicitOverride": true
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add next.config.ts tsconfig.json
git commit -m "chore(m0a): runtime boundary (serverExternalPackages) + strict TS"
```

---

### Task 3: Env/config module (zod-validated)

**Files:**
- Create: `src/lib/config.ts`, `src/lib/config.test.ts`
- Add dev deps: vitest, zod

- [ ] **Step 1: Install deps and add scripts**

Run:
```bash
npm install zod
npm install -D vitest @vitest/coverage-v8
npm pkg set scripts.test="vitest run" scripts.typecheck="tsc --noEmit" scripts.lint="next lint"
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("effectiveAiEnabled is false when flag true but no provider key", () => {
    const c = loadConfig({ VIVA_AI_ENABLED: "true" });
    expect(c.effectiveAiEnabled).toBe(false);
  });

  it("effectiveAiEnabled is true when flag true and a provider key resolves", () => {
    const c = loadConfig({ VIVA_AI_ENABLED: "true", ANTHROPIC_API_KEY: "sk-x" });
    expect(c.effectiveAiEnabled).toBe(true);
  });

  it("effectiveAiEnabled is false when flag false even with a key", () => {
    const c = loadConfig({ VIVA_AI_ENABLED: "false", OPENAI_API_KEY: "sk-x" });
    expect(c.effectiveAiEnabled).toBe(false);
  });

  it("defaults sttProvider to off and dbPath to ./data/viva.sqlite", () => {
    const c = loadConfig({});
    expect(c.sttProvider).toBe("off");
    expect(c.dbPath).toBe("./data/viva.sqlite");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/config.test.ts`
Expected: FAIL ("Cannot find module './config'").

- [ ] **Step 4: Write minimal implementation**

Create `src/lib/config.ts`:
```ts
import { z } from "zod";

const EnvSchema = z.object({
  VIVA_AI_ENABLED: z.enum(["true", "false"]).default("true"),
  AI_GATEWAY_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_VERTEX_PROJECT: z.string().optional(),
  STT_PROVIDER: z.enum(["off", "browser", "google_cloud"]).default("off"),
  VIVA_DB_PATH: z.string().default("./data/viva.sqlite"),
  RUN_LIVE_AI: z.string().optional(),
});

export type Config = {
  aiFlag: boolean;
  hasProviderKey: boolean;
  effectiveAiEnabled: boolean;
  sttProvider: "off" | "browser" | "google_cloud";
  dbPath: string;
  runLiveAi: boolean;
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.parse(env);
  const aiFlag = parsed.VIVA_AI_ENABLED === "true";
  const hasProviderKey = Boolean(
    parsed.AI_GATEWAY_API_KEY ||
      parsed.GOOGLE_GENERATIVE_AI_API_KEY ||
      parsed.ANTHROPIC_API_KEY ||
      parsed.OPENAI_API_KEY ||
      parsed.GOOGLE_VERTEX_PROJECT,
  );
  return {
    aiFlag,
    hasProviderKey,
    effectiveAiEnabled: aiFlag && hasProviderKey,
    sttProvider: parsed.STT_PROVIDER,
    dbPath: parsed.VIVA_DB_PATH,
    runLiveAi: parsed.RUN_LIVE_AI === "1",
  };
}

let cached: Config | null = null;
export function getConfig(): Config {
  if (!cached) cached = loadConfig(process.env);
  return cached;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/config.ts src/lib/config.test.ts
git commit -m "feat(m0a): zod-validated config + effective-AI-enabled semantics"
```

---

### Task 4: better-sqlite3 client (server-only, WAL, HMR singleton)

**Files:**
- Create: `src/db/client.ts`
- Add deps: better-sqlite3, server-only

- [ ] **Step 1: Install deps**

Run:
```bash
npm install better-sqlite3 server-only
npm install -D @types/better-sqlite3
```

- [ ] **Step 2: Write the failing test**

Create `src/db/client.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createDb } from "./client";

describe("createDb", () => {
  it("opens an in-memory db with WAL pragma and foreign_keys ON", () => {
    const db = createDb(":memory:");
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.prepare("INSERT INTO t (id) VALUES (?)").run(1);
    expect(db.prepare("SELECT count(*) c FROM t").get()).toEqual({ c: 1 });
    db.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/db/client.test.ts`
Expected: FAIL ("Cannot find module './client'").

- [ ] **Step 4: Write minimal implementation**

Create `src/db/client.ts`:
```ts
import "server-only";
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";

export function createDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

// HMR-safe singleton: reuse the connection across dev reloads.
const g = globalThis as unknown as { __vivaDb?: DB };

export function getDb(path: string): DB {
  if (!g.__vivaDb) g.__vivaDb = createDb(path);
  return g.__vivaDb;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/db/client.test.ts`
Expected: PASS.

> Note: `import "server-only"` throws if imported from a Client Component; vitest runs in Node so the test imports fine.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/db/client.ts src/db/client.test.ts
git commit -m "feat(m0b): better-sqlite3 client (WAL, foreign_keys, HMR singleton)"
```

---

### Task 5: Migration runner + full schema DDL

**Files:**
- Create: `src/db/migrate.ts`, `src/db/migrations/0001_init.sql`, `src/db/migrate.test.ts`, `src/test/db.ts`

- [ ] **Step 1: Write the test DB helper**

Create `src/test/db.ts`:
```ts
import { createDb } from "../db/client";
import { runMigrations } from "../db/migrate";
import type { Database as DB } from "better-sqlite3";

export function makeTestDb(): DB {
  const db = createDb(":memory:");
  runMigrations(db);
  return db;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/db/migrate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";

describe("schema", () => {
  it("creates all core tables", () => {
    const db = makeTestDb();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const t of [
      "schema_migrations", "thesis", "thesis_chunk", "evidence_unit",
      "prep_item", "prep_item_evidence", "generation_run",
      "practice_run", "practice_run_evidence", "review_item",
      "recording", "plan", "plan_day", "ai_call_log", "app_meta",
    ]) {
      expect(names).toContain(t);
    }
    db.close();
  });

  it("records the applied migration version", () => {
    const db = makeTestDb();
    const v = db.prepare("SELECT max(version) v FROM schema_migrations").get() as { v: number };
    expect(v.v).toBe(1);
    db.close();
  });

  it("enforces ON DELETE CASCADE from prep_item to prep_item_evidence", () => {
    const db = makeTestDb();
    db.exec(`
      INSERT INTO thesis (id, title, source_kind, is_active) VALUES ('t1','T','md',1);
      INSERT INTO thesis_chunk (id, thesis_id, ord, text, char_count, hash) VALUES ('c1','t1',0,'x',1,'h');
      INSERT INTO evidence_unit (id, thesis_id, chunk_id, char_start, char_end, text, hash) VALUES ('e1','t1','c1',0,1,'x','h');
      INSERT INTO prep_item (id, thesis_id, type, title, status, validation_status, validator_version, source)
        VALUES ('p1','t1','digest','D','needs_review','needs_review','v1','generated');
      INSERT INTO prep_item_evidence (prep_item_id, evidence_unit_id) VALUES ('p1','e1');
    `);
    db.prepare("DELETE FROM prep_item WHERE id='p1'").run();
    const c = db.prepare("SELECT count(*) c FROM prep_item_evidence").get() as { c: number };
    expect(c.c).toBe(0);
    db.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/db/migrate.test.ts`
Expected: FAIL ("Cannot find module '../db/migrate'").

- [ ] **Step 4: Write the schema DDL**

Create `src/db/migrations/0001_init.sql`:
```sql
-- schema_migrations is created by the migration runner's bootstrap (see migrate.ts), not here.

CREATE TABLE thesis (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  abstract TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('pdf','md','txt')),
  source_meta TEXT,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- single active thesis at a time
CREATE UNIQUE INDEX idx_thesis_one_active ON thesis (is_active) WHERE is_active = 1;

CREATE TABLE thesis_chunk (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  section TEXT,
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX idx_chunk_thesis ON thesis_chunk (thesis_id, ord);

CREATE TABLE evidence_unit (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL REFERENCES thesis_chunk(id) ON DELETE CASCADE,
  section TEXT,
  page INTEGER,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  text TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX idx_evidence_thesis ON evidence_unit (thesis_id);

CREATE TABLE generation_run (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('prep_pack','prep_item','regenerate')),
  status TEXT NOT NULL CHECK (status IN ('pending','running','done','error','canceled')),
  evidence_snapshot_hash TEXT,
  item_type TEXT,
  error TEXT,
  retries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE prep_item (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  generation_run_id TEXT REFERENCES generation_run(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('digest','key_number','qa','hostile','theory_card','citation_card')),
  title TEXT NOT NULL,
  body TEXT,
  claim_text TEXT,
  evidence_quote TEXT,
  support_kind TEXT CHECK (support_kind IN ('existence','exact_quote','numeric','llm_suggested')),
  value_numeric REAL,
  unit TEXT,
  status TEXT NOT NULL CHECK (status IN ('verified','needs_review','unsafe','draft')),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('passed','needs_review','failed')),
  validator_version TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('generated','edited','manual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT
);
CREATE INDEX idx_prep_thesis ON prep_item (thesis_id, type, status);

CREATE TABLE prep_item_evidence (
  prep_item_id TEXT NOT NULL REFERENCES prep_item(id) ON DELETE CASCADE,
  evidence_unit_id TEXT NOT NULL REFERENCES evidence_unit(id) ON DELETE RESTRICT,
  PRIMARY KEY (prep_item_id, evidence_unit_id)
);
CREATE INDEX idx_pie_evidence ON prep_item_evidence (evidence_unit_id);

CREATE TABLE practice_run (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  question_kind TEXT NOT NULL CHECK (question_kind IN ('random','by_section','cross_section','hostile','boundary','followup')),
  answer_text TEXT,
  transcript TEXT,
  scores TEXT,
  diagnosis TEXT,
  rewrite TEXT,
  follow_ups TEXT,
  status TEXT NOT NULL CHECK (status IN ('practice','saved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_practice_thesis ON practice_run (thesis_id, created_at);

CREATE TABLE practice_run_evidence (
  practice_run_id TEXT NOT NULL REFERENCES practice_run(id) ON DELETE CASCADE,
  evidence_unit_id TEXT NOT NULL REFERENCES evidence_unit(id) ON DELETE RESTRICT,
  PRIMARY KEY (practice_run_id, evidence_unit_id)
);

CREATE TABLE review_item (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  practice_run_id TEXT NOT NULL REFERENCES practice_run(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN ('evidence','clarity','completeness','boundary','delivery')),
  score INTEGER NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','fixed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (practice_run_id, dimension)
);

CREATE TABLE recording (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  practice_run_id TEXT REFERENCES practice_run(id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  duration_ms INTEGER,
  language_mode TEXT NOT NULL DEFAULT 'english' CHECK (language_mode IN ('english','chinese')),
  stt_provider TEXT,
  stt_status TEXT NOT NULL DEFAULT 'none' CHECK (stt_status IN ('none','pending','ok','error')),
  stt_error TEXT,
  transcript TEXT,
  transcript_edited INTEGER NOT NULL DEFAULT 0 CHECK (transcript_edited IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE plan (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_days INTEGER NOT NULL,
  template_key TEXT NOT NULL
);

CREATE TABLE plan_day (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  day_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  focus TEXT,
  blocks TEXT,
  materials TEXT,
  evidence_targets TEXT
);

CREATE TABLE ai_call_log (
  id TEXT PRIMARY KEY,
  thesis_id TEXT REFERENCES thesis(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  latency_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ok','error','timeout')),
  error TEXT,
  tokens TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
```

- [ ] **Step 5: Write the migration runner**

Create `src/db/migrate.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database as DB } from "better-sqlite3";

const dir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dir, "migrations");

export function runMigrations(db: DB): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)").run(version);
    });
    tx();
  }
}
```

> `schema_migrations` is created by the runner's bootstrap (`migrate.ts`), not by `0001_init.sql`, so there is no duplicate-table conflict. The migrate test asserts the table exists (the bootstrap guarantees it).

- [ ] **Step 6: Configure vitest for SQL file resolution**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/db/migrate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/db/migrate.ts src/db/migrations/0001_init.sql src/db/migrate.test.ts src/test/db.ts vitest.config.ts
git commit -m "feat(m0b): migration runner + full schema DDL with FK/constraints"
```

---

### Task 6: FTS5 evidence index + triggers

**Files:**
- Create: `src/db/migrations/0002_fts.sql`, `src/db/fts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/db/fts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";

describe("evidence_fts", () => {
  it("FTS5 is available and syncs on insert", () => {
    const db = makeTestDb();
    db.exec(`
      INSERT INTO thesis (id, title, source_kind, is_active) VALUES ('t1','T','md',1);
      INSERT INTO thesis_chunk (id, thesis_id, ord, text, char_count, hash) VALUES ('c1','t1',0,'x',1,'h');
      INSERT INTO evidence_unit (id, thesis_id, chunk_id, char_start, char_end, text, hash)
        VALUES ('e1','t1','c1',0,20,'emotional prosody study','h');
    `);
    const hit = db
      .prepare("SELECT evidence_unit_id FROM evidence_fts WHERE evidence_fts MATCH ?")
      .get("prosody") as { evidence_unit_id: string } | undefined;
    expect(hit?.evidence_unit_id).toBe("e1");
    db.close();
  });

  it("removes from index on evidence delete", () => {
    const db = makeTestDb();
    db.exec(`
      INSERT INTO thesis (id, title, source_kind, is_active) VALUES ('t1','T','md',1);
      INSERT INTO thesis_chunk (id, thesis_id, ord, text, char_count, hash) VALUES ('c1','t1',0,'x',1,'h');
      INSERT INTO evidence_unit (id, thesis_id, chunk_id, char_start, char_end, text, hash)
        VALUES ('e1','t1','c1',0,5,'hello','h');
      DELETE FROM evidence_unit WHERE id='e1';
    `);
    const c = db.prepare("SELECT count(*) c FROM evidence_fts WHERE evidence_fts MATCH 'hello'").get() as { c: number };
    expect(c.c).toBe(0);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/fts.test.ts`
Expected: FAIL ("no such table: evidence_fts").

- [ ] **Step 3: Write the FTS migration**

Create `src/db/migrations/0002_fts.sql`:
```sql
-- external-content FTS5 over evidence_unit.text, kept in sync by triggers.
CREATE VIRTUAL TABLE evidence_fts USING fts5(
  evidence_unit_id UNINDEXED,
  text,
  tokenize = 'unicode61'
);

CREATE TRIGGER evidence_ai AFTER INSERT ON evidence_unit BEGIN
  INSERT INTO evidence_fts (evidence_unit_id, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER evidence_ad AFTER DELETE ON evidence_unit BEGIN
  DELETE FROM evidence_fts WHERE evidence_unit_id = old.id;
END;

CREATE TRIGGER evidence_au AFTER UPDATE ON evidence_unit BEGIN
  DELETE FROM evidence_fts WHERE evidence_unit_id = old.id;
  INSERT INTO evidence_fts (evidence_unit_id, text) VALUES (new.id, new.text);
END;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/fts.test.ts`
Expected: PASS (2 tests). If FTS5 is unavailable, the build of better-sqlite3 includes FTS5 by default; failure here means the bundled SQLite lacks FTS5 — stop and report.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/0002_fts.sql src/db/fts.test.ts
git commit -m "feat(m0b): FTS5 evidence index with sync triggers"
```

---

### Task 7: Repository — single-active + same-thesis evidence guard

**Files:**
- Create: `src/db/repository.ts`, `src/db/repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/db/repository.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { replaceActiveThesis, bindPrepEvidence } from "./repository";

describe("replaceActiveThesis", () => {
  it("keeps exactly one active thesis", () => {
    const db = makeTestDb();
    replaceActiveThesis(db, { id: "t1", title: "A", source_kind: "md" });
    replaceActiveThesis(db, { id: "t2", title: "B", source_kind: "md" });
    const active = db.prepare("SELECT id FROM thesis WHERE is_active=1").all() as { id: string }[];
    expect(active).toEqual([{ id: "t2" }]);
    db.close();
  });
});

describe("bindPrepEvidence", () => {
  function seed(db: ReturnType<typeof makeTestDb>) {
    db.exec(`
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','A','md',1);
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t2','B','md',0);
      INSERT INTO thesis_chunk (id,thesis_id,ord,text,char_count,hash) VALUES ('c1','t1',0,'x',1,'h');
      INSERT INTO thesis_chunk (id,thesis_id,ord,text,char_count,hash) VALUES ('c2','t2',0,'y',1,'h');
      INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash) VALUES ('e1','t1','c1',0,1,'x','h');
      INSERT INTO evidence_unit (id,thesis_id,chunk_id,char_start,char_end,text,hash) VALUES ('e2','t2','c2',0,1,'y','h');
      INSERT INTO prep_item (id,thesis_id,type,title,status,validation_status,validator_version,source)
        VALUES ('p1','t1','digest','D','needs_review','needs_review','v1','generated');
    `);
  }

  it("binds same-thesis evidence", () => {
    const db = makeTestDb();
    seed(db);
    bindPrepEvidence(db, "p1", ["e1"]);
    const c = db.prepare("SELECT count(*) c FROM prep_item_evidence WHERE prep_item_id='p1'").get() as { c: number };
    expect(c.c).toBe(1);
    db.close();
  });

  it("rejects cross-thesis evidence binding", () => {
    const db = makeTestDb();
    seed(db);
    expect(() => bindPrepEvidence(db, "p1", ["e2"])).toThrow(/same thesis/i);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/repository.test.ts`
Expected: FAIL ("Cannot find module './repository'").

- [ ] **Step 3: Write minimal implementation**

Create `src/db/repository.ts`:
```ts
import "server-only";
import type { Database as DB } from "better-sqlite3";

export function replaceActiveThesis(
  db: DB,
  t: { id: string; title: string; author?: string; abstract?: string; source_kind: "pdf" | "md" | "txt" },
): void {
  const tx = db.transaction(() => {
    db.prepare("UPDATE thesis SET is_active=0 WHERE is_active=1").run();
    db.prepare(
      "INSERT INTO thesis (id,title,author,abstract,source_kind,is_active) VALUES (@id,@title,@author,@abstract,@source_kind,1)",
    ).run({ author: null, abstract: null, ...t });
  });
  tx();
}

/** Bind evidence units to a prep_item, enforcing the same-thesis invariant. */
export function bindPrepEvidence(db: DB, prepItemId: string, evidenceUnitIds: string[]): void {
  const prep = db.prepare("SELECT thesis_id FROM prep_item WHERE id=?").get(prepItemId) as
    | { thesis_id: string }
    | undefined;
  if (!prep) throw new Error(`prep_item not found: ${prepItemId}`);
  const insert = db.prepare("INSERT INTO prep_item_evidence (prep_item_id, evidence_unit_id) VALUES (?,?)");
  const tx = db.transaction(() => {
    for (const eid of evidenceUnitIds) {
      const ev = db.prepare("SELECT thesis_id FROM evidence_unit WHERE id=?").get(eid) as
        | { thesis_id: string }
        | undefined;
      if (!ev) throw new Error(`evidence_unit not found: ${eid}`);
      if (ev.thesis_id !== prep.thesis_id) {
        throw new Error(`evidence ${eid} not from the same thesis as prep_item ${prepItemId}`);
      }
      insert.run(prepItemId, eid);
    }
  });
  tx();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/db/repository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/repository.ts src/db/repository.test.ts
git commit -m "feat(m0b): repository single-active + same-thesis evidence guard"
```

---

### Task 8: Wire scripts, lint, full suite + build smoke

**Files:**
- Modify: `package.json`, `AGENTS.md`

- [ ] **Step 1: Add a `check` script**

Run:
```bash
npm pkg set scripts.check="npm run typecheck && npm run lint && npm test"
```

- [ ] **Step 2: Run the full gate**

Run: `npm run check`
Expected: typecheck clean, lint clean, all tests pass.

- [ ] **Step 3: Build smoke**

Run: `npm run build`
Expected: Next build succeeds with the DB/runtime config.

- [ ] **Step 4: Confirm AGENTS canonical commands match reality**

Verify `AGENTS.md` "Canonical commands" lists `npm run dev / test / typecheck / lint / build`. They now all exist. No edit needed unless drifted.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore(m0): check script (typecheck+lint+test) green; build smoke passes"
```

---

## Codex 互评 Gate (M0 foundation)

Per `AGENTS.md` collaboration model — **绿测试 ≠ Done**:
- [ ] Run the full suite + `npx tsc --noEmit` (Claude).
- [ ] Open a **fresh** Codex thread to review the M0 diff (schema invariants actually enforced? HMR singleton correct? migration idempotency? FTS triggers? config semantics?).
- [ ] Verify each Codex finding by grep/reading code; reconcile until both + tests agree.
- [ ] Only then mark M0 Done and proceed to the M0c plan (LLM client/registry/mock/canary + leveled validator).

---

## Self-Review Notes (author)

- **Spec coverage:** §4 runtime boundary (Task 2), §6 full schema incl. join invariants + enums + single-active + FTS (Tasks 5–7), §14 env effective-enabled (Task 3). M0c items (validator levels, LLM client, canary) intentionally deferred to the next plan.
- **Deferred to M0c plan:** `evidence/validator.ts` (L1–L3 deterministic + L4 LLM-suggested), `lib/llm/*`, cross-provider structured-output canary, `MockLlmClient`.
- **Type consistency:** table/column names here are the contract for later plans (e.g. `prep_item.validation_status`, `support_kind`, `evidence_unit.char_start/char_end`).
