/**
 * Downloads the latest yt-dlp.exe AND a Windows ffmpeg.exe and writes them
 * into the electron-builder resources/ folder so they get bundled into the
 * installer.
 *
 * Runs as part of `npm run build:electron` so every installer ships with a
 * current yt-dlp + ffmpeg. The downloaded binaries are gitignored - the build
 * is always fresh.
 *
 * On first launch, electron/main.ts copies them into %APPDATA%\Yoink\ if no
 * copy already lives there. From then on the user owns them (the in-app
 * Update button writes new yt-dlp versions to the same location).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "electron", "resources");

fs.mkdirSync(outDir, { recursive: true });

const sizeMB = (p) => (fs.statSync(p).size / 1024 / 1024).toFixed(1);

/** Downloads `url` to `dest`, throwing on any non-OK / empty response. */
async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  if (!res.body) throw new Error(`no response body for ${url}`);
  const arrayBuf = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(arrayBuf));
}

// ---------------------------------------------------------------------------
//  1. yt-dlp
// ---------------------------------------------------------------------------

const ytdlpFile = path.join(outDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const ytdlpUrl = process.platform === "win32"
  ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
  : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

console.log(`[fetch-ytdlp] downloading ${ytdlpUrl}`);
try {
  await download(ytdlpUrl, ytdlpFile);
} catch (err) {
  console.error(`[fetch-ytdlp] yt-dlp download failed: ${err.message}`);
  process.exit(1);
}
console.log(`[fetch-ytdlp] wrote ${ytdlpFile} (${sizeMB(ytdlpFile)} MB)`);

// ---------------------------------------------------------------------------
//  2. ffmpeg (Windows static build from yt-dlp/FFmpeg-Builds)
// ---------------------------------------------------------------------------
//  The release ships ffmpeg.exe inside a zip; Node has no built-in unzip, so
//  on Windows we shell out to PowerShell's Expand-Archive (this is a Windows
//  build script). A flaky ffmpeg mirror should produce a clear error and a
//  non-zero exit (so CI notices) without corrupting the yt-dlp we already
//  fetched.

const ffmpegFile = path.join(outDir, "ffmpeg.exe");
const ffmpegZipUrl =
  "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip";

if (process.platform !== "win32") {
  console.warn("[fetch-ytdlp] skipping ffmpeg fetch (non-Windows build host)");
} else {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yoink-ffmpeg-"));
  const zipPath = path.join(tmpDir, "ffmpeg.zip");
  try {
    console.log(`[fetch-ytdlp] downloading ${ffmpegZipUrl}`);
    await download(ffmpegZipUrl, zipPath);
    console.log(`[fetch-ytdlp] extracting ffmpeg.exe (zip ${sizeMB(zipPath)} MB)`);

    // Expand-Archive into tmpDir, then locate ffmpeg.exe in the nested
    // bin/ folder (the zip's top-level dir name is versioned, so we search).
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmpDir}' -Force`,
      ],
      { stdio: ["ignore", "inherit", "inherit"] }
    );

    const found = findFile(tmpDir, "ffmpeg.exe");
    if (!found) throw new Error("ffmpeg.exe not found inside extracted archive");
    fs.copyFileSync(found, ffmpegFile);
    console.log(`[fetch-ytdlp] wrote ${ffmpegFile} (${sizeMB(ffmpegFile)} MB)`);
  } catch (err) {
    console.error(`[fetch-ytdlp] ffmpeg fetch failed: ${err.message}`);
    process.exit(1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Recursively searches `dir` for a file named `name`, returns its path or null. */
function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return null;
}
