import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { findYtdlp } from "@/lib/ytdlp";

const execFileAsync = promisify(execFile);

export async function GET() {
  try {
    // Get current installed version
    const { stdout } = await execFileAsync(findYtdlp(), ["--version"], {
      timeout: 5_000,
    });
    const current = stdout.trim();

    // Get latest release tag from GitHub
    const res = await fetch("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest", {
      headers: { "User-Agent": "ytdlp-gui" },
    });
    const { tag_name: latest } = await res.json();

    return NextResponse.json({ updateAvailable: latest !== current, current, latest });
  } catch {
    return NextResponse.json({ updateAvailable: false });
  }
}
