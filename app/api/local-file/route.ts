import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/local-file?path=<absolute file path>
 *
 * Streams a local file to the browser. Used by the editor pages to preview
 * downloaded media files via <video src="/api/local-file?path=..."> etc.
 *
 * Supports HTTP Range requests so the browser can seek through long files
 * without buffering the whole thing.
 *
 * Safety: paths are restricted to files that already exist on disk. Since
 * this server only ever runs bound to 127.0.0.1 there's no remote attack
 * surface, but we still refuse paths containing nulls or that don't resolve
 * to a real file.
 */
export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath || filePath.includes("\0")) {
    return new Response("Bad path", { status: 400 });
  }

  const resolved = path.resolve(filePath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new Response("Not a file", { status: 400 });

  const size = stat.size;
  const contentType = mimeFor(resolved);

  const range = req.headers.get("range");
  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
      if (start > end || start >= size) {
        return new Response("Range not satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(resolved, { start, end });
      return new Response(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        },
      });
    }
  }

  const stream = fs.createReadStream(resolved);
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    },
  });
}

function mimeFor(p: string): string {
  const ext = path.extname(p).toLowerCase();
  const map: Record<string, string> = {
    ".mp4":  "video/mp4",
    ".webm": "video/webm",
    ".mkv":  "video/x-matroska",
    ".mov":  "video/quicktime",
    ".m4v":  "video/x-m4v",
    ".mp3":  "audio/mpeg",
    ".m4a":  "audio/mp4",
    ".opus": "audio/opus",
    ".ogg":  "audio/ogg",
    ".wav":  "audio/wav",
    ".flac": "audio/flac",
  };
  return map[ext] || "application/octet-stream";
}
