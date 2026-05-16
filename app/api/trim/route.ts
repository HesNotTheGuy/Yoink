import { NextRequest } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { findFfmpeg, buildTrimArgs, parseProgressBlock } from "@/lib/ffmpeg";

export const dynamic = "force-dynamic";

/**
 * POST /api/trim
 * Body: { input: string, inSec: number, outSec: number, output?: string, copyStreams?: boolean }
 *
 * Streams Server-Sent Events:
 *   { type: "start", duration }
 *   { type: "progress", percent, outTimeSec, speed }
 *   { type: "done", output }
 *   { type: "error", message }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const input: string = body.input;
  const inSec: number = Number(body.inSec);
  const outSec: number = Number(body.outSec);
  const copyStreams: boolean | undefined = body.copyStreams;

  if (!input || !fs.existsSync(input)) {
    return jsonError("Input file does not exist", 400);
  }
  if (!isFinite(inSec) || !isFinite(outSec) || outSec <= inSec) {
    return jsonError("Invalid in/out times", 400);
  }

  // Default output: <input dir>/<input name>-trimmed<ext>
  const parsed = path.parse(input);
  const output: string = body.output || path.join(parsed.dir, `${parsed.name}-trimmed${parsed.ext}`);

  const duration = outSec - inSec;
  const args = buildTrimArgs({ input, output, inSec, outSec, copyStreams });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send({ type: "start", duration, output });

      const proc = spawn(findFfmpeg(), args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdoutBuf = "";
      let stderrBuf = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString("utf8");
        // ffmpeg emits a progress block every ~250ms ending with `progress=continue\n`
        const idx = stdoutBuf.lastIndexOf("progress=");
        if (idx === -1) return;
        const end = stdoutBuf.indexOf("\n", idx);
        if (end === -1) return;
        const block = stdoutBuf.slice(0, end + 1);
        stdoutBuf = stdoutBuf.slice(end + 1);

        const parsed = parseProgressBlock(block);
        if (parsed.outTimeSec != null) {
          const percent = Math.min(100, (parsed.outTimeSec / duration) * 100);
          send({
            type: "progress",
            percent,
            outTimeSec: parsed.outTimeSec,
            speed: parsed.speed,
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
          const lastErr = stderrBuf.trim().split("\n").pop() || `ffmpeg exited with code ${code}`;
          send({ type: "error", message: lastErr });
        }
        controller.close();
      });

      proc.on("error", (err) => {
        send({ type: "error", message: `Failed to spawn ffmpeg: ${err.message}` });
        controller.close();
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

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
