// macOS Electron packaging pipeline. Run: `npm run electron:pack -- --arch arm64`.
// Gated standalone build -> copy assets -> rebuild better-sqlite3 for Electron's ABI/arch
// -> copy it into the standalone -> package an unsigned .app -> restore the root
// better-sqlite3 so dev/tests keep working.
import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VALID_ARCHES = new Set(["arm64", "x64", "universal"]);
const DIST_DIR = "dist-electron";
const APP_NAME = "D-viva-assistant-agent";

const sh = (cmd, env = {}) =>
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

function readArg(name) {
  const prefix = `${name}=`;
  const index = process.argv.findIndex((arg) => arg === name || arg.startsWith(prefix));
  if (index === -1) return undefined;
  const value = process.argv[index].startsWith(prefix)
    ? process.argv[index].slice(prefix.length)
    : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function targetArch() {
  const arch = readArg("--arch") ?? process.env.ELECTRON_PACK_ARCH ?? process.arch;
  if (!VALID_ARCHES.has(arch)) {
    throw new Error(`Unsupported Electron pack arch "${arch}". Use arm64, x64, or universal.`);
  }
  return arch;
}

function betterSqliteNode(moduleRoot) {
  return join(moduleRoot, "build/Release/better_sqlite3.node");
}

function rebuildBetterSqlite3(arch) {
  sh(`npx @electron/rebuild -f -w better-sqlite3 -a ${arch}`);
}

function copyBetterSqlite3ToStandalone(moduleRoot = "node_modules/better-sqlite3") {
  const target = ".next/standalone/node_modules/better-sqlite3";
  rmSync(target, { recursive: true, force: true });
  cpSync(moduleRoot, target, { recursive: true });
}

function copyStandaloneAssets() {
  cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
  if (existsSync("public")) cpSync("public", ".next/standalone/public", { recursive: true });
}

function materializeStandaloneNodeModuleLinks() {
  const tracedNodeModules = ".next/standalone/.next/node_modules";
  if (!existsSync(tracedNodeModules)) return;

  for (const entry of readdirSync(tracedNodeModules, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;

    const linkPath = join(tracedNodeModules, entry.name);
    const realPath = realpathSync(linkPath);
    rmSync(linkPath, { recursive: true, force: true });
    cpSync(realPath, linkPath, { recursive: true });
  }
}

function prepareSingleArchNativeModule(arch) {
  rebuildBetterSqlite3(arch);
  copyBetterSqlite3ToStandalone();
  sh(`file "${betterSqliteNode(".next/standalone/node_modules/better-sqlite3")}"`);
}

function prepareUniversalNativeModule() {
  const tempDir = mkdtempSync(join(tmpdir(), "d-viva-electron-native-"));
  const moduleCopies = {
    arm64: join(tempDir, "better-sqlite3-arm64"),
    x64: join(tempDir, "better-sqlite3-x64"),
  };

  try {
    for (const arch of ["arm64", "x64"]) {
      rebuildBetterSqlite3(arch);
      cpSync("node_modules/better-sqlite3", moduleCopies[arch], { recursive: true });
      sh(`file "${betterSqliteNode(moduleCopies[arch])}"`);
    }

    copyBetterSqlite3ToStandalone(moduleCopies.arm64);
    const universalNode = betterSqliteNode(".next/standalone/node_modules/better-sqlite3");
    sh(
      `lipo -create -output "${universalNode}" ` +
        `"${betterSqliteNode(moduleCopies.arm64)}" "${betterSqliteNode(moduleCopies.x64)}"`
    );
    sh(`lipo -archs "${universalNode}"`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function outputDirsForArch(arch) {
  if (arch === "x64") return ["mac"];
  if (arch === "universal") {
    return ["mac-universal", "mac-universal-x64-temp", "mac-universal-arm64-temp"];
  }
  return [`mac-${arch}`];
}

function cleanTargetOutput(arch) {
  for (const dir of outputDirsForArch(arch)) {
    rmSync(join(DIST_DIR, dir), { recursive: true, force: true });
  }
}

function findPackagedApp(arch) {
  const preferredDirs = outputDirsForArch(arch).map((dir) => join(DIST_DIR, dir));
  const fallbackDirs = existsSync(DIST_DIR)
    ? readdirSync(DIST_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("mac"))
        .map((entry) => join(DIST_DIR, entry.name))
    : [];

  for (const dir of [...preferredDirs, ...fallbackDirs]) {
    if (!existsSync(dir)) continue;
    const appName = readdirSync(dir).find((name) => name.endsWith(".app"));
    if (appName) return join(dir, appName);
  }

  throw new Error(`Packaged .app not found for ${arch} under ${DIST_DIR}/mac*`);
}

function copyStandaloneNodeModulesIntoApp(appPath) {
  const standaloneInApp = join(appPath, "Contents/Resources/standalone");
  cpSync(".next/standalone/node_modules", join(standaloneInApp, "node_modules"), {
    recursive: true,
  });
}

const arch = targetArch();
console.log(`\nPackaging ${APP_NAME} for macOS ${arch}`);

// 1. Standalone build (gated) + copy static/public into it.
try {
  sh("next build", { BUILD_STANDALONE: "1" });
  copyStandaloneAssets();

  // 2. Rebuild better-sqlite3 for Electron's ABI, then copy it into standalone node_modules.
  if (arch === "universal") {
    prepareUniversalNativeModule();
  } else {
    prepareSingleArchNativeModule(arch);
  }
  materializeStandaloneNodeModuleLinks();

  // 3. Package an unsigned, unpacked .app.
  cleanTargetOutput(arch);
  sh(`npx electron-builder --mac --dir --${arch} --publish never`);

  // 3b. electron-builder strips the standalone's top-level node_modules from extraResources
  //     (it expects to manage deps itself), so the Electron-ABI better-sqlite3 lands in
  //     Resources/app.asar.unpacked where standalone/server.js can't resolve it. Copy the
  //     Next-traced standalone node_modules into the .app so require("better-sqlite3")
  //     resolves the right binary at runtime.
  const appPath = findPackagedApp(arch);
  copyStandaloneNodeModulesIntoApp(appPath);
  sh(`file "${betterSqliteNode(join(appPath, "Contents/Resources/standalone/node_modules/better-sqlite3"))}"`);

  console.log(`\nDone -> ${appPath}`);
  console.log("First open: right-click -> Open, unsigned.");
} finally {
  // 4. Restore the root better-sqlite3 to the system Node ABI (so tests/dev keep working).
  sh("npm rebuild better-sqlite3");
  sh(`file "${betterSqliteNode("node_modules/better-sqlite3")}"`);
}
