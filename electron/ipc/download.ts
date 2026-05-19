/**
 * download IPC handler — spawns yt-dlp and streams progress back to the
 * renderer via the `yoink:stream:<id>` channel set up by `streamingCall`
 * in preload.ts.
 *
 * Channels:
 *   download:start  ({ ...DownloadRequest, __streamId }) => downloadId
 *   download:cancel (downloadId) => void
 *
 * Mirrors the logic in `app/api/download/route.ts` but uses Electron
 * `event.sender.send` to push events instead of holding subscribers in
 * an in-memory broadcast set.
 */

import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "node:crypto";
import {
  findYtdlp,
  buildFormatArgs,
  buildSubtitleArgs,
  buildTailArgs,
  parseProgressLine,
  parseTitleLine,
  type SubtitleOptions,
} from "@/lib/ytdlp";

interface StartPayload {
  url: string;
  mode: "video" | "audio";
  quality: string;
  formatId?: string;
  outputDir: string;
  thumbnail?: string;
  embedMetadata?: boolean;
  embedThumbnail?: boolean;
  cookiesFile?: string;
  speedLimit?: string;
  subtitles?: SubtitleOptions;
  __streamId: string;
}

// Module-scoped registry of live processes so `download:cancel` can find
// the right child to kill. Entries are removed on close.
const active = new Map<string, ChildProcess>();

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(
    "download:start",
    async (event: IpcMainInvokeEvent, payload: StartPayload): Promise<string> => {
      const {
        url,
        mode,
        quality,
        formatId,
        outputDir,
        embedMetadata,
        embedThumbnail,
        cookiesFile,
        speedLimit,
        subtitles,
        __streamId,
      } = payload;

      const id = randomUUID();
      const channel = `yoink:stream:${__streamId}`;

      // Helper that drops events on the floor if the renderer window has
      // already been closed (sender destroyed). Avoids "object has been
      // destroyed" exceptions on shutdown.
      const send = (msg: unknown): void => {
        if (event.sender.isDestroyed()) return;
        event.sender.send(channel, msg);
      };

      const args = [
        ...buildFormatArgs({ mode, quality, formatId, embedMetadata, embedThumbnail }),
        ...buildSubtitleArgs(subtitles, mode),
        ...buildTailArgs({
          cookiesFile,
          speedLimit,
          outputTemplate: `${outputDir}\\%(title)s.%(ext)s`,
        }),
        url,
      ];

      const proc = spawn(findYtdlp(), args);
      active.set(id, proc);

      let titleSent = false;
      let lastStderr = "";

      proc.stdout?.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (!line.trim()) continue;
          send({ type: "log", text: line });

          const progress = parseProgressLine(line);
          if (progress) {
            send({
              type: "progress",
              percent: progress.progress,
              speed: progress.speed,
              eta: progress.eta,
            });
          }

          const title = parseTitleLine(line);
          if (title && !titleSent) {
            titleSent = true;
            send({ type: "title", title });
          }
        }
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        // Track the last non-empty stderr line for use in error messages.
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines.length) lastStderr = lines[lines.length - 1];
        send({ type: "log", text });
      });

      // Resolve the invoke() promise only after the process exits, so the
      // renderer's streamingCall listener stays attached until done/error
      // is emitted. (`finally` in preload removes the listener on resolve.)
      await new Promise<void>((resolve) => {
        proc.on("close", (code) => {
          active.delete(id);
          if (code === 0) {
            send({ type: "done" });
          } else {
            const message = lastStderr || `yt-dlp exited with code ${code}`;
            send({ type: "error", message });
          }
          resolve();
        });

        proc.on("error", (err) => {
          active.delete(id);
          send({ type: "error", message: err.message });
          resolve();
        });
      });

      return id;
    },
  );

  ipcMain.handle("download:cancel", async (_event, id: string): Promise<void> => {
    const proc = active.get(id);
    if (!proc) return;
    proc.kill();
    active.delete(id);
  });
}
