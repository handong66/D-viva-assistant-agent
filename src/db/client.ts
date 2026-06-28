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
const g = globalThis as unknown as {
  __dVivaAssistantAgentDb?: DB;
  __dVivaAssistantAgentDbPath?: string;
};

export function getDb(path: string): DB {
  if (g.__dVivaAssistantAgentDb) {
    if (g.__dVivaAssistantAgentDbPath !== path) {
      throw new Error(
        `getDb already opened with path "${g.__dVivaAssistantAgentDbPath}"; refusing to reopen with "${path}"`,
      );
    }
    return g.__dVivaAssistantAgentDb;
  }
  const db = createDb(path);
  runMigrations(db);
  g.__dVivaAssistantAgentDb = db;
  g.__dVivaAssistantAgentDbPath = path;
  return g.__dVivaAssistantAgentDb;
}
