import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { findYtdlp } from "@/lib/ytdlp";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const proc = spawn(findYtdlp(), ["-U"]);

      proc.stdout.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) send({ type: "log", text: line });
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) send({ type: "log", text: line });
        }
      });

      proc.on("close", (code) => {
        if (code === 0) {
          send({ type: "done", message: "yt-dlp is up to date!" });
        } else {
          send({ type: "error", message: `Update exited with code ${code}` });
        }
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
