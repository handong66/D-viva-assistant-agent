import { createDb } from "../db/client";
import { runMigrations } from "../db/migrate";
import type { Database as DB } from "better-sqlite3";

/** In-memory migrated DB for deterministic tests. */
export function makeTestDb(): DB {
  const db = createDb(":memory:");
  runMigrations(db);
  return db;
}
