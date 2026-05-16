import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { downloads, type Download } from "@/lib/store";
import {
  findYtdlp,
  buildFormatArgs,
  buildSubtitleArgs,
  buildTailArgs,
  parseProgressLine,
  parseTitleLine,
  type SubtitleOptions,
} from "@/lib/ytdlp";

export async function POST(req: NextRequest) {
  const {
    url,
    mode,
    quality,
    formatId,
    outputDir,
    thumbnail,
    embedMetadata,
    embedThumbnail,
    cookiesFile,
    speedLimit,
    subtitles,
  }: {
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
  } = await req.json();

  if (!url || !outputDir) {
    return NextResponse.json({ error: "Missing url or outputDir" }, { status: 400 });
  }

  const id = uuidv4();

  const dl: Download = {
    id,
    url,
    title: "",
    thumbnail: thumbnail ?? "",
    status: "pending",
    progress: 0,
    speed: "",
    eta: "",
    error: "",
    outputDir,
    mode,
    quality,
    createdAt: Date.now(),
    subscribers: new Set(),
  };
  downloads.set(id, dl);

  // Build args via the shared library
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

  const ytdlp = spawn(findYtdlp(), args);
  dl.proc = ytdlp;
  dl.status = "downloading";

  const broadcast = (line: string) => dl.subscribers.forEach((cb) => cb(line));

  ytdlp.stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (!line.trim()) continue;
      broadcast(JSON.stringify({ type: "log", text: line }));

      const progress = parseProgressLine(line);
      if (progress) {
        dl.progress = progress.progress;
        dl.speed = progress.speed;
        dl.eta = progress.eta;
        broadcast(JSON.stringify({ type: "progress", ...progress }));
      }

      const title = parseTitleLine(line);
      if (title && !dl.title) {
        dl.title = title;
        broadcast(JSON.stringify({ type: "title", title }));
      }
    }
  });

  ytdlp.stderr.on("data", (chunk: Buffer) => {
    broadcast(JSON.stringify({ type: "log", text: chunk.toString() }));
  });

  ytdlp.on("close", (code) => {
    if (code === 0) {
      dl.status = "done";
      dl.progress = 100;
      broadcast(JSON.stringify({ type: "done" }));
    } else if (dl.error !== "Cancelled") {
      dl.status = "error";
      dl.error = dl.error || `yt-dlp exited with code ${code}`;
      broadcast(JSON.stringify({ type: "error", message: dl.error }));
    }
    dl.subscribers.clear();
  });

  return NextResponse.json({ id });
}
