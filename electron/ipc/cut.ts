/**
 * cut IPC handler — multi-segment video cut/concat via ffmpeg.
 *
 * Channel:
 *   cut:run  ({ input, segments, output?, __streamId })
 *
 * Streams events back to the renderer over `yoink:stream:<__streamId>`:
 *   { type: "start", totalDuration, output }
 *   { type: "segment", index, total }
 *   { type: "progress", percent }
 *   { type: "done", output }
 *   { type: "error", message }
 *
 * Pipeline:
 *   1. For each segment, ffmpeg-trim into an intermediate file with -c copy.
 *   2. Write a concat list referencing those intermediates.
 *   3. ffmpeg concat-demuxer them into the final output.
 *   4. Clean up all intermediates + list file regardless of success/failure.
 *
 * Ported from app/api/cut/route.ts.
 */

import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import {
  findFfmpeg,
  buildConcatArgs,
  secondsToTimestamp,
  parseProgressBlock,
} from "@/lib/ffmpeg";

interface Segment {
  start: number;
  end: number;
}

interface CutPayload {
  input?: string;
  segments?: unknown;
  output?: string;
  __streamId?: string;
}

export function register(ipcMain: IpcMain): void {
  ipcMain.handle("cut:run", async (event: IpcMainInvokeEvent, payload: CutPayload): Promise<void> => {
    const streamId = payload.__streamId;
    const channel = `yoink:stream:${streamId}`;
    const send = (msg: object) => {
      if (!streamId) return;
      event.sender.send(channel, msg);
    };

    const input = payload.input ?? "";
    const rawSegments = payload.segments;

    if (!input || !fs.existsSync(input)) {
      send({ type: "error", message: "Input file does not exist" });
      return;
    }
    if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
      send({ type: "error", message: "segments must be a non-empty array" });
      return;
    }

    const segments: Segment[] = [];
    for (let i = 0; i < rawSegments.length; i++) {
      const seg = rawSegments[i] as { start?: unknown; end?: unknown };
      const start = Number(seg?.start);
      const end = Number(seg?.end);
      if (!isFinite(start) || !isFinite(end) || end <= start) {
        send({
          type: "error",
          message: `Invalid segment at index ${i}: end must be > start`,
        });
        return;
      }
      segments.push({ start, end });
    }

    const parsed = path.parse(input);
    const output =
      payload.output || path.join(parsed.dir, `${parsed.name}-cut${parsed.ext}`);

    const ext = parsed.ext || ".mp4";
    const totalDuration = segments.reduce((acc, s) => acc + (s.end - s.start), 0);

    // Pre-compute intermediate paths so the finally-cleanup can reach them
    // even if we bail early.
    const sessionId = crypto.randomBytes(6).toString("hex");
    const tmpDir = os.tmpdir();
    const intermediates: string[] = segments.map((_, idx) =>
      path.join(tmpDir, `yoink-cut-${sessionId}-${idx}${ext}`),
    );
    const listFile = path.join(tmpDir, `yoink-concat-${sessionId}.txt`);

    const ffmpegPath = findFfmpeg();

    const cleanup = () => {
      for (const p of intermediates) {
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {
          // ignore
        }
      }
      try {
        if (fs.existsSync(listFile)) fs.unlinkSync(listFile);
      } catch {
        // ignore
      }
    };

    try {
      send({ type: "start", totalDuration, output });

      // ---------------------------------------------------------------
      // Step 1: produce intermediate trims sequentially.
      // ---------------------------------------------------------------
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        send({ type: "segment", index: i, total: segments.length });
        const duration = Math.max(0, seg.end - seg.start);
        const trimArgs = [
          "-y",
          "-ss",
          secondsToTimestamp(seg.start),
          "-i",
          input,
          "-t",
          duration.toFixed(3),
          "-c",
          "copy",
          "-avoid_negative_ts",
          "make_zero",
          intermediates[i],
        ];

        const result = await runFfmpeg(ffmpegPath, trimArgs);
        if (!result.success) {
          send({
            type: "error",
            message: `Failed to trim segment ${i + 1}/${segments.length}: ${result.error}`,
          });
          return;
        }
        if (!fs.existsSync(intermediates[i])) {
          send({
            type: "error",
            message: `Intermediate file missing for segment ${i + 1}`,
          });
          return;
        }
      }

      // ---------------------------------------------------------------
      // Step 2: write concat list. ffmpeg concat-demuxer wants:
      //   file '<absolute path>'
      // Single quotes in the path must be escaped as: '\''
      // ---------------------------------------------------------------
      try {
        const listBody = intermediates
          .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
          .join("\n");
        fs.writeFileSync(listFile, listBody, "utf8");
      } catch (e) {
        send({
          type: "error",
          message: `Failed to write concat list: ${(e as Error).message}`,
        });
        return;
      }

      // ---------------------------------------------------------------
      // Step 3: run final concat with streamed progress.
      // ---------------------------------------------------------------
      const concatArgs = buildConcatArgs(listFile, output);

      await new Promise<void>((resolve) => {
        const proc = spawn(ffmpegPath, concatArgs, {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdoutBuf = "";
        let stderrBuf = "";

        proc.stdout.on("data", (chunk: Buffer) => {
          stdoutBuf += chunk.toString("utf8");
          const idx = stdoutBuf.lastIndexOf("progress=");
          if (idx === -1) return;
          const end = stdoutBuf.indexOf("\n", idx);
          if (end === -1) return;
          const block = stdoutBuf.slice(0, end + 1);
          stdoutBuf = stdoutBuf.slice(end + 1);

          const prog = parseProgressBlock(block);
          if (prog.outTimeSec != null && totalDuration > 0) {
            const percent = Math.min(100, (prog.outTimeSec / totalDuration) * 100);
            send({ type: "progress", percent });
          }
        });

        proc.stderr.on("data", (chunk: Buffer) => {
          stderrBuf += chunk.toString("utf8");
        });

        proc.on("close", (code) => {
          if (code === 0 && fs.existsSync(output)) {
            send({ type: "done", output });
          } else {
            const lastErr =
              stderrBuf.trim().split("\n").pop() ||
              `ffmpeg exited with code ${code}`;
            send({ type: "error", message: lastErr });
          }
          resolve();
        });

        proc.on("error", (err) => {
          send({ type: "error", message: `Failed to spawn ffmpeg: ${err.message}` });
          resolve();
        });
      });
    } catch (e) {
      send({ type: "error", message: `Unexpected error: ${(e as Error).message}` });
    } finally {
      cleanup();
    }
  });
}

/**
 * Runs ffmpeg once and resolves with success/error. Used for intermediate
 * trims where we don't need streamed progress — just need to know if it
 * worked before moving on.
 */
function runFfmpeg(
  bin: string,
  args: string[],
): Promise<{ success: boolean; error: string }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderrBuf = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, error: "" });
      } else {
        const lastErr =
          stderrBuf.trim().split("\n").pop() || `ffmpeg exited with code ${code}`;
        resolve({ success: false, error: lastErr });
      }
    });
    proc.on("error", (err) => {
      resolve({ success: false, error: `spawn failed: ${err.message}` });
    });
  });
}
