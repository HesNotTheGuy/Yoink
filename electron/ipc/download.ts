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
import path from "path";
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
  id: string;
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

// Marker emitted by yt-dlp's `--print after_move:[YOINK_PATH]%(filepath)s`.
// We scan stdout for this so we can report the FINAL on-disk path (after
// any merge/remux/post-processing) rather than guessing from the template.
const RE_YOINK_PATH = /^\[YOINK_PATH\](.+)$/;

// Module-scoped registry of live processes so `download:cancel` can find
// the right child to kill. Entries are removed on close.
const active = new Map<string, ChildProcess>();

// Ids the renderer asked to cancel. Used so the `close` handler can emit a
// clean terminal event instead of reporting the kill as an error.
const cancelled = new Set<string>();

/**
 * Shared registry of EVERY live child process spawned by the streaming
 * handlers (downloads + ffmpeg ops). The trim/cut/trim-audio handlers
 * import this and add/remove their procs so the before-quit hook in
 * main.ts can tear them all down. Keeping one registry here avoids adding
 * a new shared module that other agents might also be editing.
 */
export const activeProcs = new Set<ChildProcess>();

/**
 * Kill a process and its descendants. On Windows `proc.kill()` does NOT
 * reap yt-dlp's spawned ffmpeg grandchild, so use `taskkill /T /F` to take
 * down the whole tree. Falls back to `proc.kill()` elsewhere. (taskkill is
 * invoked via spawn with an argument array — no shell, no injection path.)
 */
export function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }
  } else {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Tear down every tracked download. Called from main.ts on before-quit.
 */
export function killAllDownloads(): void {
  for (const proc of activeProcs) {
    killProcessTree(proc);
  }
  activeProcs.clear();
  active.clear();
}

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(
    "download:start",
    async (event: IpcMainInvokeEvent, payload: StartPayload): Promise<string> => {
      const {
        id,
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
          outputTemplate: path.join(outputDir, "%(title)s.%(ext)s"),
        }),
        // Capture the FINAL output path after any post-processing move.
        // --no-simulate ensures --print doesn't suppress the download.
        "--print",
        "after_move:[YOINK_PATH]%(filepath)s",
        "--no-simulate",
        // `--` terminates option parsing so a URL beginning with `-` can't
        // be interpreted as a yt-dlp flag.
        "--",
        url,
      ];

      const proc = spawn(findYtdlp(), args);
      active.set(id, proc);
      activeProcs.add(proc);

      let titleSent = false;
      let lastStderr = "";
      let finalPath = "";

      proc.stdout?.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (!line.trim()) continue;

          // Final-path marker: capture but don't surface as a log line.
          const mPath = RE_YOINK_PATH.exec(line.trim());
          if (mPath) {
            finalPath = mPath[1].trim();
            continue;
          }

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
          activeProcs.delete(proc);
          const wasCancelled = cancelled.delete(id);
          if (wasCancelled) {
            // User-initiated cancel: not an error.
            send({ type: "done" });
          } else if (code === 0) {
            send({ type: "done", output: finalPath || undefined });
          } else {
            const message = lastStderr || `yt-dlp exited with code ${code}`;
            send({ type: "error", message });
          }
          resolve();
        });

        proc.on("error", (err) => {
          active.delete(id);
          activeProcs.delete(proc);
          cancelled.delete(id);
          const message =
            (err as NodeJS.ErrnoException).code === "ENOENT"
              ? "yt-dlp not found. Click 'Update yt-dlp' or reinstall Yoink."
              : err.message;
          send({ type: "error", message });
          resolve();
        });
      });

      return id;
    },
  );

  ipcMain.handle("download:cancel", async (_event, id: string): Promise<void> => {
    const proc = active.get(id);
    if (!proc) return;
    // Flag first so the close handler reports a clean terminal event.
    cancelled.add(id);
    killProcessTree(proc);
    active.delete(id);
  });
}
