import { sql as m0001 } from "./0001_init";
import { sql as m0002 } from "./0002_fts";
import { sql as m0003 } from "./0003_plan_created_at";

/** Ordered list of migrations. Add new entries with the next integer version. */
export const migrations: { version: number; sql: string }[] = [
  { version: 1, sql: m0001 },
  { version: 2, sql: m0002 },
  { version: 3, sql: m0003 },
];
