/**
 * ytdlp lifecycle IPC handlers — check for and apply updates.
 *
 * Mirrors the Next.js /api/check-update and /api/update-ytdlp routes but
 * routed through Electron IPC instead of HTTP/SSE.
 *
 * Channels:
 *   ytdlp:check-update () => { current, latest, updateAvailable }
 *   ytdlp:update       ({ __streamId }) => void   (streaming via yoink:stream:<id>)
 */

import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { spawn } from "child_process";
import { findYtdlp, getYtdlpVersion } from "@/lib/ytdlp";

interface CheckUpdateResult {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

export function register(ipcMain: IpcMain): void {
  ipcMain.handle("ytdlp:check-update", async (): Promise<CheckUpdateResult> => {
    try {
      // Current installed version. Throws if yt-dlp isn't installed.
      const current = await getYtdlpVersion();

      // Latest release tag from GitHub.
      const res = await fetch("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest", {
        headers: { "User-Agent": "yoink" },
      });
      const json = (await res.json()) as { tag_name?: string };
      const latest = json.tag_name ?? "";

      return { current, latest, updateAvailable: latest !== current };
    } catch {
      return { current: "", latest: "", updateAvailable: false };
    }
  });

  ipcMain.handle(
    "ytdlp:update",
    async (event: IpcMainInvokeEvent, payload: { __streamId: string }): Promise<void> => {
      const { __streamId } = payload;
      const channel = `yoink:stream:${__streamId}`;
      const send = (msg: object): void => {
        event.sender.send(channel, msg);
      };

      return new Promise<void>((resolve) => {
        const proc = spawn(findYtdlp(), ["-U"]);

        const emitLines = (chunk: Buffer): void => {
          for (const line of chunk.toString().split("\n")) {
            if (line.trim()) send({ type: "log", text: line });
          }
        };

        proc.stdout.on("data", emitLines);
        proc.stderr.on("data", emitLines);

        proc.on("close", (code) => {
          if (code === 0) {
            send({ type: "done", message: "yt-dlp is up to date!" });
          } else {
            send({ type: "error", message: `Update exited with code ${code}` });
          }
          resolve();
        });

        proc.on("error", (err) => {
          send({ type: "error", message: `Update failed: ${err.message}` });
          resolve();
        });
      });
    }
  );
}
