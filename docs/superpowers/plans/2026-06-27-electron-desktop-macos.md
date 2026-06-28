# Electron desktop packaging (macOS, local double-click)

> **Workflow:** build-pipeline task. After this (design-reviewed) plan, **Claude writes the wrapper AND runs/debugs the pipeline in stages** (Codex can't run npm/electron-builder/native rebuilds). Final "double-click opens a window" is a human check (GUI). **Revised after design round 1** (2 P0 + 2 P1 fixes baked in).

**Goal:** a **double-clickable, unsigned macOS `.app`** that launches D-viva-assistant-agent (starts the Next server internally, opens a window); DB + recordings live in the macOS app-data dir. Local use only, macOS only.

**Design (round-1 corrected):**
- Next `output: "standalone"` is **gated behind `BUILD_STANDALONE=1`** (so normal `npm run build`/`start`/`dev` + all 219 tests are unaffected — `next start` does NOT support standalone).
- The standalone server tree ships as **`extraResources`** at `process.resourcesPath/standalone/` — OUTSIDE asar, because Next's standalone `server.js` does `process.chdir(__dirname)`, which fails inside an asar archive (the critical P0).
- `package.json` gets **`"main": "electron/main.cjs"`** (the packaged app's entry point).
- `better-sqlite3` is rebuilt for Electron's ABI and copied into the standalone, then the **root tree is restored** to Node-25 ABI so dev/tests keep working.

**The crux — better-sqlite3 ABI:** the installed binary is Node-25 ABI; Electron needs its own ABI. Rebuild it for Electron, copy into the standalone's `node_modules`, then `npm rebuild better-sqlite3` to put the root back. Node-smoke the standalone BEFORE the Electron rebuild (so it runs under Node 25).

---

### Task 1: wrapper files + gated standalone

**Files:** Modify `next.config.ts`, `package.json`, `.gitignore`; Create `electron/main.cjs`, `scripts/pack-electron.mjs`

- [ ] **next.config.ts** — gate standalone (do NOT set it permanently):
```ts
const nextConfig: NextConfig = {
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  serverExternalPackages: ["better-sqlite3"],
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
};
```

- [ ] **electron/main.cjs** — spawn the standalone server (Electron-as-node) + open a window; `extraResources` path when packaged:
```js
const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const net = require("node:net");
let serverProc = null;
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
const waitPort = (port, end = Date.now() + 30000) => new Promise((res, rej) => { const t = () => { const c = net.connect(port, "127.0.0.1"); c.once("connect", () => { c.end(); res(); }); c.once("error", () => { c.destroy(); Date.now() > end ? rej(new Error("server start timeout")) : setTimeout(t, 200); }); }; t(); });
const serverEntry = () => app.isPackaged
  ? path.join(process.resourcesPath, "standalone", "server.js")
  : path.join(__dirname, "..", ".next", "standalone", "server.js");
async function main() {
  const port = await freePort();
  const userData = app.getPath("userData");
  serverProc = spawn(process.execPath, [serverEntry()], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1",
      VIVA_DB_PATH: path.join(userData, "d-viva-assistant-agent.sqlite"), RECORDINGS_DIR: path.join(userData, "recordings") },
    stdio: "inherit",
  });
  await waitPort(port);
  const win = new BrowserWindow({ width: 1280, height: 860, title: "D-viva-assistant-agent" });
  await win.loadURL(`http://127.0.0.1:${port}`);
}
const stop = () => { if (serverProc && !serverProc.killed) serverProc.kill(); };
app.whenReady().then(main).catch((e) => { console.error(e); stop(); app.quit(); });
app.on("before-quit", stop);
app.on("window-all-closed", () => { stop(); if (process.platform !== "darwin") app.quit(); });
```

- [ ] **package.json** — add `"main": "electron/main.cjs"`; devDeps `electron`, `electron-builder`, `@electron/rebuild`; script `"electron:pack": "node scripts/pack-electron.mjs"`; and the build config (standalone via `extraResources`, NOT asarUnpack):
```jsonc
"build": {
  "appId": "com.handong66.dvivaassistantagent",
  "productName": "D-viva-assistant-agent",
  "files": ["electron/**", "package.json"],
  "extraResources": [{ "from": ".next/standalone", "to": "standalone" }],
  "mac": { "target": "dir", "identity": null },
  "directories": { "output": "dist-electron" }
}
```
(The launcher needs no node_modules; the server's traced node_modules ride in `extraResources`. `identity:null` = unsigned → first open is right-click → Open.)

- [ ] **.gitignore** — add `dist-electron/`.

### Task 2: the pipeline (`scripts/pack-electron.mjs`) — run by Claude in two stages

- [ ] **scripts/pack-electron.mjs**:
```js
import { execSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
const sh = (cmd, env) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
// 1. standalone build (gated) + copy static/public into it
sh("next build", { BUILD_STANDALONE: "1" });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
cpSync("public", ".next/standalone/public", { recursive: true });
// 2. rebuild better-sqlite3 for Electron, copy into standalone
sh("npx @electron/rebuild -f -w better-sqlite3");
rmSync(".next/standalone/node_modules/better-sqlite3", { recursive: true, force: true });
cpSync("node_modules/better-sqlite3", ".next/standalone/node_modules/better-sqlite3", { recursive: true });
// 3. package (unsigned, unpacked .app)
sh("npx electron-builder --mac --dir");
// 4. restore root better-sqlite3 to the system Node ABI (dev/tests work again)
sh("npm rebuild better-sqlite3");
console.log("done → dist-electron/");
```

- [ ] **Claude runs it in stages, smoking BEFORE the Electron rebuild:**
  1. **Stage A:** `BUILD_STANDALONE=1 npm run build`, then copy static/public, then **Node-smoke** the standalone under Node 25 (its better-sqlite3 still matches): `PORT=4123 VIVA_DB_PATH=/tmp/v.sqlite RECORDINGS_DIR=/tmp/vrec node .next/standalone/server.js &`; `curl -sf localhost:4123/` returns the home HTML **and** `curl -sf -o /dev/null -w '%{http_code}' localhost:4123/_next/static/...` a real static asset returns 200 (proves standalone + DB + migrations + assets work). Kill it.
  2. **Stage B:** `npx @electron/rebuild -f -w better-sqlite3` → copy into standalone → `npx electron-builder --mac --dir` → confirm `dist-electron/mac*/D-viva-assistant-agent.app` exists → `npm rebuild better-sqlite3` (restore) → `npm test` still green (proves the root tree is restored).
  - **Human:** double-click `dist-electron/mac*/D-viva-assistant-agent.app` (first time: right-click → Open, unsigned) → a window opens with the app; data appears under `~/Library/Application Support/D-viva-assistant-agent/`.

- [ ] **Commit** the wrapper (`next.config.ts`, `electron/`, `scripts/`, `package.json`, `.gitignore`) — `git commit -m "feat(desktop): macOS Electron wrapper (gated standalone + extraResources + better-sqlite3 ABI rebuild)"`. (Do not commit `dist-electron/`.)

---

## Red lines / constraints

1. **Local-first preserved:** same local server; DB + recordings move to `userData`; nothing new leaves the machine; AI/STT optional + off by default.
2. **No app behaviour change:** packaging only. `output` is env-gated so `npm run build`/`start`/`dev` + 219 tests are unchanged; the pipeline restores root better-sqlite3 so tests pass after.
3. **No fabrication/AI/validator change.**

## Self-review / risks (round-1 corrected)

- **P0 fixed:** `"main"` added; the standalone ships via `extraResources` (real FS path) so Next's `process.chdir(__dirname)` works (the asar blocker is gone).
- **P1 fixed:** `output` is `BUILD_STANDALONE`-gated (no `next start` breakage); the pipeline Node-smokes BEFORE the Electron rebuild and `npm rebuild`s the root after (dev/tests survive).
- **Confirmed by review:** Server Actions need no `allowedOrigins` (Origin == Host == `127.0.0.1:<port>`); only better-sqlite3 needs the rebuild (`unpdf` is pure JS).
- **Residual risk (empirical — surfaced by running):** electron-builder `files`/`extraResources` layout, the exact `mac.target:"dir"` output dir name, and the Electron version's ABI vs `@electron/rebuild`. Claude debugs these live; the Node-smoke + the `npm test`-after-restore + the human double-click are the three checkpoints.
