import { NextRequest } from "next/server";
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

export const dynamic = "force-dynamic";

interface Segment {
  start: number;
  end: number;
}

/**
 * POST /api/cut
 * Body: { input: string, segments: { start: number, end: number }[], output?: string }
 *
 * Streams Server-Sent Events:
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
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const input: string = body.input;
  const rawSegments: unknown = body.segments;

  if (!input || !fs.existsSync(input)) {
    return jsonError("Input file does not exist", 400);
  }
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return jsonError("segments must be a non-empty array", 400);
  }

  const segments: Segment[] = [];
  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i] as { start?: unknown; end?: unknown };
    const start = Number(seg?.start);
    const end = Number(seg?.end);
    if (!isFinite(start) || !isFinite(end) || end <= start) {
      return jsonError(`Invalid segment at index ${i}: end must be > start`, 400);
    }
    segments.push({ start, end });
  }

  const parsed = path.parse(input);
  const output: string =
    body.output || path.join(parsed.dir, `${parsed.name}-cut${parsed.ext}`);

  const ext = parsed.ext || ".mp4";
  const totalDuration = segments.reduce((acc, s) => acc + (s.end - s.start), 0);

  // Generate intermediate file paths up-front so cleanup can find them later.
  const sessionId = crypto.randomBytes(6).toString("hex");
  const tmpDir = os.tmpdir();
  const intermediates: string[] = segments.map((_, idx) =>
    path.join(tmpDir, `yoink-cut-${sessionId}-${idx}${ext}`),
  );
  const listFile = path.join(tmpDir, `yoink-concat-${sessionId}.txt`);

  const ffmpegPath = findFfmpeg();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (data: object) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

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

      const fail = (message: string) => {
        send({ type: "error", message });
        cleanup();
        finish();
      };

      (async () => {
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

          const ok = await runFfmpeg(ffmpegPath, trimArgs);
          if (!ok.success) {
            fail(
              `Failed to trim segment ${i + 1}/${segments.length}: ${ok.error}`,
            );
            return;
          }
          if (!fs.existsSync(intermediates[i])) {
            fail(`Intermediate file missing for segment ${i + 1}`);
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
          fail(`Failed to write concat list: ${(e as Error).message}`);
          return;
        }

        // ---------------------------------------------------------------
        // Step 3: run final concat with streamed progress.
        // ---------------------------------------------------------------
        const concatArgs = buildConcatArgs(listFile, output);
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

          const parsedProg = parseProgressBlock(block);
          if (parsedProg.outTimeSec != null && totalDuration > 0) {
            const percent = Math.min(
              100,
              (parsedProg.outTimeSec / totalDuration) * 100,
            );
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
          cleanup();
          finish();
        });

        proc.on("error", (err) => {
          send({
            type: "error",
            message: `Failed to spawn ffmpeg: ${err.message}`,
          });
          cleanup();
          finish();
        });
      })().catch((e: unknown) => {
        fail(`Unexpected error: ${(e as Error).message}`);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * Runs ffmpeg once and resolves with success/error. Used for intermediate
 * trims where we don't need to stream progress — just need to know if it
 * worked before moving on to the next segment.
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
          stderrBuf.trim().split("\n").pop() ||
          `ffmpeg exited with code ${code}`;
        resolve({ success: false, error: lastErr });
      }
    });
    proc.on("error", (err) => {
      resolve({ success: false, error: `spawn failed: ${err.message}` });
    });
  });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
