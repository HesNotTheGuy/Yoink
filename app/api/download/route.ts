import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { downloads, type Download } from "@/lib/store";

export async function POST(req: NextRequest) {
  const { url, mode, quality, formatId, outputDir, thumbnail, embedMetadata, embedThumbnail, cookiesFile, speedLimit } =
    await req.json();

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

  // Build yt-dlp args
  const args: string[] = [];

  if (mode === "audio") {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
    if (formatId && formatId !== "bestvideo+bestaudio/best") args.push("-f", formatId);
    if (embedMetadata) args.push("--embed-metadata");
    if (embedThumbnail) args.push("--embed-thumbnail");
  } else {
    if (formatId && formatId !== "bestvideo+bestaudio/best") {
      args.push("-f", formatId);
    } else {
      const formatMap: Record<string, string> = {
        best: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "1080p": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]",
        "720p": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]",
        "480p": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]",
        "360p": "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]",
      };
      args.push("-f", formatMap[quality] ?? formatMap["best"]);
    }
    args.push("--merge-output-format", "mp4");
    if (embedMetadata) args.push("--embed-metadata", "--embed-chapters");
  }

  if (cookiesFile) args.push("--cookies", cookiesFile);
  if (speedLimit) args.push("--limit-rate", speedLimit);
  args.push("--newline", "-o", `${outputDir}\\%(title)s.%(ext)s`, url);

  const ytdlp = spawn("yt-dlp", args);
  dl.proc = ytdlp;
  dl.status = "downloading";

  const broadcast = (line: string) => dl.subscribers.forEach((cb) => cb(line));

  const progressRe = /\[download\]\s+([\d.]+)%\s+of\s+[\d.]+\S+\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/;
  const titleRe = /\[(?:download|info)\].*Destination:\s*.*[/\\](.+)$/;

  ytdlp.stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (!line.trim()) continue;
      broadcast(JSON.stringify({ type: "log", text: line }));

      const pm = line.match(progressRe);
      if (pm) {
        dl.progress = parseFloat(pm[1]);
        dl.speed = pm[2];
        dl.eta = pm[3];
        broadcast(JSON.stringify({ type: "progress", progress: dl.progress, speed: dl.speed, eta: dl.eta }));
      }

      const tm = line.match(titleRe);
      if (tm && !dl.title) {
        dl.title = tm[1];
        broadcast(JSON.stringify({ type: "title", title: dl.title }));
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
