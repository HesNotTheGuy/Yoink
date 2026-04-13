import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface Format {
  format_id: string;
  ext: string;
  resolution: string;
  fps: number | null;
  vcodec: string;
  acodec: string;
  filesize: number | null;
  format_note: string;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      ["--dump-json", "--no-download", "--no-playlist", url],
      { timeout: 20_000 }
    );
    const info = JSON.parse(stdout.trim().split("\n")[0]);
    const formats: Format[] = (info.formats ?? []).map((f: Format) => ({
      format_id: f.format_id,
      ext: f.ext,
      resolution: f.resolution ?? "audio only",
      fps: f.fps ?? null,
      vcodec: f.vcodec ?? "none",
      acodec: f.acodec ?? "none",
      filesize: f.filesize ?? null,
      format_note: f.format_note ?? "",
    }));
    return NextResponse.json({ formats });
  } catch {
    return NextResponse.json({ error: "Could not fetch formats" }, { status: 500 });
  }
}
