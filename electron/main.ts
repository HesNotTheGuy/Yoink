/**
 * Electron main process — entry point.
 *
 * Responsibilities:
 *   1. Create the application window.
 *   2. Register IPC handlers (each handler lives in `electron/ipc/<name>.ts`
 *      and exports a `register(ipcMain)` function).
 *   3. Register the `yoink-file://` protocol so the renderer can stream
 *      local files into <video src="...">.
 *   4. Apply the Yoink data dir convention (%APPDATA%\Yoink\ on Windows).
 *
 * Handlers are imported by name below. Agents porting individual handlers
 * only need to fill in the body of their handler file — the registration
 * lines here already exist, so nobody fights over main.ts.
 */

import { app, BrowserWindow, ipcMain, protocol, shell } from "electron";
import path from "path";
import fs from "fs";

// IPC handler registrations - each handler file is registered once here.
// During the migration any handler that isn't implemented yet just falls
// back to the Next.js dev server via lib/api-client.ts.
import { register as registerHistory } from "./ipc/history";
import { register as registerSettings } from "./ipc/settings";
import { register as registerInfo } from "./ipc/info";
import { register as registerFormats } from "./ipc/formats";
import { register as registerDownload } from "./ipc/download";
import { register as registerTrim } from "./ipc/trim";
import { register as registerCut } from "./ipc/cut";
import { register as registerTrimAudio } from "./ipc/trim-audio";
import { register as registerYtdlp } from "./ipc/ytdlp";
import { register as registerFolder } from "./ipc/folder";

const isDev = !app.isPackaged;
const DEV_URL = "http://localhost:3000";

// Single instance lock so double-clicking the icon doesn't spawn a second
// Yoink. The second instance just focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
}

function getDataDir(): string {
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "Yoink");
  }
  return path.join(app.getPath("home"), ".yoink");
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#070b14", // matches the Slate theme so no white flash
    show: false,
    title: "Yoink",
    icon: path.join(__dirname, "..", "yoink.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs Node access to require ipcRenderer
    },
  });

  win.once("ready-to-show", () => win.show());

  // External links open in the user's default browser, not inside Yoink
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  if (isDev) {
    await win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Production: Next.js static export goes in out/
    const indexPath = path.join(__dirname, "..", "out", "index.html");
    await win.loadFile(indexPath);
  }
}

/**
 * Custom protocol: `yoink-file://<absolute-path>` returns the contents
 * of that local file. Used by the editor pages to stream downloaded
 * media into the HTML5 <video> element. The renderer never gets raw
 * filesystem access - it only sees URLs.
 */
function registerYoinkFileProtocol() {
  protocol.handle("yoink-file", async (request) => {
    try {
      const url = new URL(request.url);
      // yoink-file://host/<encoded path>  OR  yoink-file:///<encoded path>
      const raw = decodeURIComponent(url.pathname.replace(/^\//, ""));
      if (!raw || raw.includes("\0") || !fs.existsSync(raw)) {
        return new Response("Not found", { status: 404 });
      }
      const stat = fs.statSync(raw);
      if (!stat.isFile()) return new Response("Not a file", { status: 400 });
      const stream = fs.createReadStream(raw);
      return new Response(stream as unknown as ReadableStream, {
        headers: {
          "Content-Length": String(stat.size),
          "Accept-Ranges": "bytes",
        },
      });
    } catch (e) {
      return new Response(`Error: ${(e as Error).message}`, { status: 500 });
    }
  });
}

app.whenReady().then(async () => {
  // Ensure data dir exists before any handler tries to write to it
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  registerYoinkFileProtocol();

  // Register every IPC handler. New handlers added to electron/ipc/ should
  // also be imported and registered above. This file is the ONE place the
  // full handler list is declared.
  registerHistory(ipcMain);
  registerSettings(ipcMain);
  registerInfo(ipcMain);
  registerFormats(ipcMain);
  registerDownload(ipcMain);
  registerTrim(ipcMain);
  registerCut(ipcMain);
  registerTrimAudio(ipcMain);
  registerYtdlp(ipcMain);
  registerFolder(ipcMain);

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
