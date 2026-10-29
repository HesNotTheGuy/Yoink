/**
 * ytdlp lifecycle IPC handlers — check for and apply updates.
 *
 * Update strategy: download the latest yt-dlp binary directly into
 * %APPDATA%\Yoink\ (a user-writable location). findYtdlp() already
 * checks that path first, so the freshly-downloaded binary takes
 * priority over any system-PATH copy on the next call. The download
 * is checked against that release's SHA2-256SUMS before it replaces
 * the installed binary. A missing checksum or a mismatch leaves the
 * previous binary in place.
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
import path from "path";
import os from "os";
import { getYtdlpVersion } from "@/lib/ytdlp";
import { assetNameForPlatform, downloadVerifiedYtdlp } from "@/lib/ytdlp-integrity.mjs";
import { activeDownloadCount } from "./download";

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
      const assetName = assetNameForPlatform();
      const targetPath = path.join(dataDir, assetName);

      try {
        let lastReported = 0;
        const release = await downloadVerifiedYtdlp({
          dest: targetPath,
          assetName,
          onStatus: (message) => send({ type: "log", text: message }),
          onProgress: (received, total) => {
            if (received - lastReported < 2 * 1024 * 1024 && received !== total) return;
            lastReported = received;
            const mb = (received / 1024 / 1024).toFixed(1);
            const ofTotal = total ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : "";
            send({ type: "log", text: `  ${mb} MB${ofTotal}` });
          },
        });

        send({
          type: "log",
          text: `Installed yt-dlp ${release.tag} to ${targetPath}`,
        });
        send({ type: "done", message: "yt-dlp updated successfully!" });
      } catch (err) {
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
