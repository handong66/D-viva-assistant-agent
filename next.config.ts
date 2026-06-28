import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone server output for the Electron desktop build ONLY (gated): `next start` does not
  // support standalone, so normal `next dev`/`build`/`start` + tests are unaffected.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  // better-sqlite3 is a native Node module; keep it external to server bundles.
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // Thesis PDFs routinely exceed the 1 MB Server Action default, which would 413
    // the import POST before the action can return a friendly inline error.
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;
