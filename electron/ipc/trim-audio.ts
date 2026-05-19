/**
 * trim-audio IPC handler — audio-only trim via ffmpeg, re-encoded to the
 * requested codec.
 *
 * Channel:
 *   trim-audio:run  ({ input, inSec, outSec, codec, output?, __streamId })
 *
 * Streams events back to the renderer over `yoink:stream:<__streamId>`:
 *   { type: "start", duration, output }
 *   { type: "progress", percent, outTimeSec, speed }
 *   { type: "done", output }
 *   { type: "error", message }
 *
 * Ported from app/api/trim-audio/route.ts.
 */

import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { findFfmpeg, buildAudioTrimArgs, parseProgressBlock } from "@/lib/ffmpeg";

type AudioCodec = "mp3" | "wav" | "flac" | "aac";

const CODEC_EXT: Record<AudioCodec, string> = {
  mp3: "mp3",
  wav: "wav",
  flac: "flac",
  aac: "m4a",
};

interface TrimAudioPayload {
  input?: string;
  inSec?: number;
  outSec?: number;
  codec?: AudioCodec;
  output?: string;
  __streamId?: string;
}

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(
    "trim-audio:run",
    async (event: IpcMainInvokeEvent, payload: TrimAudioPayload): Promise<void> => {
      const streamId = payload.__streamId;
      const channel = `yoink:stream:${streamId}`;
      const send = (msg: object) => {
        if (!streamId) return;
        event.sender.send(channel, msg);
      };

      const input = payload.input ?? "";
      const inSec = Number(payload.inSec);
      const outSec = Number(payload.outSec);
      const codec = payload.codec as AudioCodec | undefined;

      if (!input || !fs.existsSync(input)) {
        send({ type: "error", message: "Input file does not exist" });
        return;
      }
      if (!isFinite(inSec) || !isFinite(outSec) || outSec <= inSec) {
        send({ type: "error", message: "Invalid in/out times" });
        return;
      }
      if (codec !== "mp3" && codec !== "wav" && codec !== "flac" && codec !== "aac") {
        send({ type: "error", message: "Invalid codec" });
        return;
      }

      const parsed = path.parse(input);
      const ext = CODEC_EXT[codec];
      const output =
        payload.output || path.join(parsed.dir, `${parsed.name}-clip.${ext}`);

      const duration = outSec - inSec;
      const args = buildAudioTrimArgs({ input, output, inSec, outSec, codec });

      await new Promise<void>((resolve) => {
        send({ type: "start", duration, output });

        const proc = spawn(findFfmpeg(), args, { stdio: ["ignore", "pipe", "pipe"] });
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
          if (prog.outTimeSec != null) {
            const percent = Math.min(100, (prog.outTimeSec / duration) * 100);
            send({
              type: "progress",
              percent,
              outTimeSec: prog.outTimeSec,
              speed: prog.speed,
            });
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
              stderrBuf.trim().split("\n").pop() || `ffmpeg exited with code ${code}`;
            send({ type: "error", message: lastErr });
          }
          resolve();
        });

        proc.on("error", (err) => {
          send({ type: "error", message: `Failed to spawn ffmpeg: ${err.message}` });
          resolve();
        });
      });
    },
  );
}
