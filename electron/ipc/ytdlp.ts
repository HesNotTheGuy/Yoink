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
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getYtdlpVersion } from "@/lib/ytdlp";
import { activeDownloadCount } from "./download";

/**
 * Retries a synchronous fs operation that can transiently fail on Windows
 * when antivirus / the search indexer briefly locks a freshly written .exe.
 * Retries only the lock-class errno codes; anything else rethrows immediately.
 */
function retryFsSync<T>(fn: () => T, attempts = 5, delayMs = 150): T {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === "EBUSY" || code === "EPERM" || code === "EACCES";
      if (!transient || i >= attempts - 1) throw err;
      // Synchronous spin-wait: this runs in the update handler off the
      // render path, and a short blocking pause is simpler than threading
      // async through the rename. Total worst-case wait is attempts*delayMs.
      const until = Date.now() + delayMs;
      while (Date.now() < until) { /* busy-wait briefly */ }
    }
  }
}

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

      // Refuse to update while a download is running: the running yt-dlp.exe
      // (the same seeded copy we're about to replace) holds a Windows image
      // lock, so the unlink/rename below would fail with EPERM. Tell the user
      // plainly instead of surfacing a raw OS error.
      if (activeDownloadCount() > 0) {
        send({
          type: "error",
          message: "Finish or cancel your active downloads before updating yt-dlp.",
        });
        return;
      }

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

        // Stream to a .download tempfile, then move into place. Use
        // stream/promises pipeline so a mid-stream write error (disk full,
        // I/O fault, AV lock) rejects cleanly into the catch below instead
        // of throwing as an uncaught exception that crashes the main
        // process and skips temp cleanup. A pass-through counts bytes for
        // the progress log.
        const contentLength = Number(res.headers.get("content-length") ?? 0);
        let received = 0;
        let lastReported = 0;
        const progress = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            received += chunk.length;
            if (received - lastReported >= 2 * 1024 * 1024) {
              lastReported = received;
              const mb = (received / 1024 / 1024).toFixed(1);
              const total = contentLength ? ` / ${(contentLength / 1024 / 1024).toFixed(1)} MB` : "";
              send({ type: "log", text: `  ${mb} MB${total}` });
            }
            cb(null, chunk);
          },
        });

        await pipeline(
          Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
          progress,
          fs.createWriteStream(tempPath)
        );

        // Guard against a silently-truncated download (connection dropped on
        // a chunked response that undici can't length-check). If the server
        // advertised a length, the file must match it before we install.
        if (contentLength > 0) {
          const got = fs.statSync(tempPath).size;
          if (got !== contentLength) {
            throw new Error(`incomplete download (${got} of ${contentLength} bytes)`);
          }
        }

        // Move into place. unlink + rename can transiently fail on Windows
        // when AV / the indexer briefly locks the freshly written .exe, so
        // retry the lock-class errors a few times before giving up.
        retryFsSync(() => {
          if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
          fs.renameSync(tempPath, targetPath);
        });

        const sizeMB = (fs.statSync(targetPath).size / 1024 / 1024).toFixed(1);
        send({ type: "log", text: `Installed to ${targetPath} (${sizeMB} MB)` });
        send({ type: "done", message: "yt-dlp updated successfully!" });
      } catch (err) {
        // Clean up partial download
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
        }
        const code = (err as NodeJS.ErrnoException).code;
        const message =
          code === "EBUSY" || code === "EPERM" || code === "EACCES"
            ? "yt-dlp is in use — close any running downloads and try again."
            : `Update failed: ${(err as Error).message}`;
        send({ type: "error", message });
      }
    }
  );
}
