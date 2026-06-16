/**
 * ytdlp lifecycle IPC handlers — check for and apply updates.
 *
 * Update strategy: download the latest yt-dlp.exe directly into
 * %APPDATA%\Yoink\ (a user-writable location). findYtdlp() already
 * checks that path first, so the freshly-downloaded binary takes
 * priority over any system-PATH copy on the next call.
 *
 * Why NOT `yt-dlp -U`: it relies on yt-dlp being able to overwrite
 * itself in place. That fails when yt-dlp lives in a non-writable
 * folder (Program Files, Pictures, etc.). Downloading fresh sidesteps
 * the whole permission question.
 *
 * Channels:
 *   ytdlp:check-update () => { current, latest, updateAvailable }
 *   ytdlp:update       ({ __streamId }) => void   (streaming via yoink:stream:<id>)
 */

import type { IpcMain, IpcMainInvokeEvent } from "electron";
import fs from "fs";
import path from "path";
import os from "os";
import { getYtdlpVersion } from "@/lib/ytdlp";

interface CheckUpdateResult {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

function getDataDir(): string {
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "Yoink");
  }
  return path.join(os.homedir(), ".yoink");
}

function getYtdlpFilename(): string {
  return process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
}

const YTDLP_URL = process.platform === "win32"
  ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
  : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

export function register(ipcMain: IpcMain): void {
  ipcMain.handle("ytdlp:check-update", async (): Promise<CheckUpdateResult> => {
    // Current installed version. getYtdlpVersion() throws if yt-dlp is
    // missing — treat that distinctly so the UI can still offer "Update"
    // (current stays "" but a latest version is fetched below).
    let current = "";
    try {
      current = await getYtdlpVersion();
    } catch {
      current = "";
    }

    try {
      // Latest release tag from GitHub. Check res.ok before parsing JSON so
      // a 403/rate-limit/network blip doesn't masquerade as "up to date".
      const res = await fetch("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest", {
        headers: { "User-Agent": "yoink" },
      });
      if (!res.ok) {
        // Couldn't determine latest — report current with no update offered.
        return { current, latest: "", updateAvailable: false };
      }
      const json = (await res.json()) as { tag_name?: string };
      const latest = json.tag_name ?? "";

      // If yt-dlp isn't installed at all, an update is clearly available.
      const updateAvailable = !current || (latest !== "" && latest !== current);
      return { current, latest, updateAvailable };
    } catch {
      // Network error: don't throw, but don't falsely claim up-to-date.
      return { current, latest: "", updateAvailable: false };
    }
  });

  ipcMain.handle(
    "ytdlp:update",
    async (event: IpcMainInvokeEvent, payload: { __streamId: string }): Promise<void> => {
      const { __streamId } = payload;
      const channel = `yoink:stream:${__streamId}`;
      const send = (msg: object): void => {
        if (event.sender.isDestroyed()) return;
        event.sender.send(channel, msg);
      };

      const dataDir = getDataDir();
      const targetPath = path.join(dataDir, getYtdlpFilename());
      const tempPath = `${targetPath}.download`;

      try {
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }

        send({ type: "log", text: `Downloading latest yt-dlp from GitHub...` });
        send({ type: "log", text: `  ${YTDLP_URL}` });

        const res = await fetch(YTDLP_URL, { redirect: "follow" });
        if (!res.ok) {
          send({ type: "error", message: `Download failed: HTTP ${res.status} ${res.statusText}` });
          return;
        }
        if (!res.body) {
          send({ type: "error", message: "Download failed: no response body" });
          return;
        }

        // Stream to a .download tempfile first, then rename atomically.
        // Avoids leaving a half-written yt-dlp.exe in place if the network drops.
        const contentLength = Number(res.headers.get("content-length") ?? 0);
        const writer = fs.createWriteStream(tempPath);
        let received = 0;
        let lastReported = 0;

        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          writer.write(Buffer.from(value));
          received += value.length;
          // Throttle log messages: once per 2 MB.
          if (received - lastReported >= 2 * 1024 * 1024) {
            lastReported = received;
            const mb = (received / 1024 / 1024).toFixed(1);
            const total = contentLength ? ` / ${(contentLength / 1024 / 1024).toFixed(1)} MB` : "";
            send({ type: "log", text: `  ${mb} MB${total}` });
          }
        }
        writer.end();
        await new Promise<void>((resolve, reject) => {
          writer.on("finish", () => resolve());
          writer.on("error", reject);
        });

        // Move into place. On Windows, rename onto an existing file works
        // only if the destination is closed - if Yoink is mid-spawn this
        // would fail; in practice the update button is a manual action so
        // there's no concurrent spawn.
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        fs.renameSync(tempPath, targetPath);

        const sizeMB = (fs.statSync(targetPath).size / 1024 / 1024).toFixed(1);
        send({ type: "log", text: `Installed to ${targetPath} (${sizeMB} MB)` });
        send({ type: "done", message: "yt-dlp updated successfully!" });
      } catch (err) {
        // Clean up partial download
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
        }
        send({ type: "error", message: `Update failed: ${(err as Error).message}` });
      }
    }
  );
}
