import type { Database as DB } from "better-sqlite3";
import { migrations } from "./migrations";

/**
 * Apply all pending migrations inside transactions. Idempotent.
 * Migrations are embedded TS strings (see ./migrations) so they survive
 * Next.js production bundling — no filesystem reads at runtime.
 */
export function runMigrations(db: DB): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  for (const { version, sql } of migrations) {
    if (applied.has(version)) continue;
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)").run(version);
    });
    tx();
  }
}
