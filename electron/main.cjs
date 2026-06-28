const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const net = require("node:net");

let serverProc = null;

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });

const waitPort = (port, end = Date.now() + 30000) =>
  new Promise((resolve, reject) => {
    const tick = () => {
      const c = net.connect(port, "127.0.0.1");
      c.once("connect", () => {
        c.end();
        resolve();
      });
      c.once("error", () => {
        c.destroy();
        if (Date.now() > end) reject(new Error("server start timeout"));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });

// Next's standalone server.js does process.chdir(__dirname), which fails inside asar — so it ships
// as extraResources (a real filesystem path) when packaged.
const serverEntry = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "standalone", "server.js")
    : path.join(__dirname, "..", ".next", "standalone", "server.js");

async function main() {
  const port = await freePort();
  const userData = app.getPath("userData");
  serverProc = spawn(process.execPath, [serverEntry()], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      VIVA_DB_PATH: path.join(userData, "d-viva-assistant-agent.sqlite"),
      RECORDINGS_DIR: path.join(userData, "recordings"),
    },
    stdio: "inherit",
  });
  serverProc.on("exit", (code) => {
    if (code) console.error("[D-viva-assistant-agent] server exited with code", code);
  });
  await waitPort(port);
  const win = new BrowserWindow({ width: 1280, height: 860, title: "D-viva-assistant-agent" });
  await win.loadURL(`http://127.0.0.1:${port}`);
}

const stop = () => {
  if (serverProc && !serverProc.killed) serverProc.kill();
};

app.whenReady().then(main).catch((e) => {
  console.error(e);
  stop();
  app.quit();
});
app.on("before-quit", stop);
app.on("window-all-closed", () => {
  stop();
  if (process.platform !== "darwin") app.quit();
});
