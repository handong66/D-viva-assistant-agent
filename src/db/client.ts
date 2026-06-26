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
const g = globalThis as unknown as { __vivaDb?: DB; __vivaDbPath?: string };

export function getDb(path: string): DB {
  if (g.__vivaDb) {
    if (g.__vivaDbPath !== path) {
      throw new Error(
        `getDb already opened with path "${g.__vivaDbPath}"; refusing to reopen with "${path}"`,
      );
    }
    return g.__vivaDb;
  }
  const db = createDb(path);
  runMigrations(db);
  g.__vivaDb = db;
  g.__vivaDbPath = path;
  return g.__vivaDb;
}
