import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node" },
  // `server-only` throws when imported outside a React Server bundle; alias it to a
  // no-op so server-only modules (db client, repository) can be unit-tested in Node.
  resolve: {
    alias: {
      "server-only": path.resolve(import.meta.dirname, "src/test/empty.ts"),
    },
  },
});
