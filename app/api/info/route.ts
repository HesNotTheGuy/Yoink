import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

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
    return NextResponse.json({
      title: info.title ?? "",
      thumbnail: info.thumbnail ?? "",
      duration: info.duration ?? null,
      uploader: info.uploader ?? info.channel ?? "",
    });
  } catch {
    return NextResponse.json({ error: "Could not fetch info" }, { status: 500 });
  }
}
