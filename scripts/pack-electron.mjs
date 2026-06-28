// macOS Electron packaging pipeline. Run: `npm run electron:pack`.
// Gated standalone build → copy assets → rebuild better-sqlite3 for Electron's ABI → copy it into
// the standalone → package an unsigned .app → restore the root better-sqlite3 (so dev/tests work).
import { execSync } from "node:child_process";
import { cpSync, rmSync, existsSync } from "node:fs";

const sh = (cmd, env) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

// 1. Standalone build (gated) + copy static/public into it.
sh("next build", { BUILD_STANDALONE: "1" });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
if (existsSync("public")) cpSync("public", ".next/standalone/public", { recursive: true });

// 2. Rebuild better-sqlite3 for Electron's ABI, then copy it into the standalone's node_modules.
sh("npx @electron/rebuild -f -w better-sqlite3");
rmSync(".next/standalone/node_modules/better-sqlite3", { recursive: true, force: true });
cpSync("node_modules/better-sqlite3", ".next/standalone/node_modules/better-sqlite3", { recursive: true });

// 3. Package an unsigned, unpacked .app.
sh("npx electron-builder --mac --dir");

// 3b. electron-builder strips the standalone's top-level node_modules from extraResources
//     (it expects to manage deps itself), so the Electron-ABI better-sqlite3 lands in
//     Resources/app.asar.unpacked where the standalone's server.js can't resolve it. Copy
//     the Next-traced standalone node_modules into the .app so `require("better-sqlite3")`
//     resolves the right binary at runtime.
import { readdirSync } from "node:fs";
import { join } from "node:path";
const macOut = "dist-electron/mac-arm64";
const appName = readdirSync(macOut).find((n) => n.endsWith(".app"));
if (!appName) throw new Error("packaged .app not found in " + macOut);
const standaloneInApp = join(macOut, appName, "Contents/Resources/standalone");
cpSync(".next/standalone/node_modules", join(standaloneInApp, "node_modules"), { recursive: true });

// 4. Restore the root better-sqlite3 to the system Node ABI (so `npm test` / `next dev` work again).
sh("npm rebuild better-sqlite3");
console.log("\n✓ done → dist-electron/  (first open: right-click → Open, unsigned)");
