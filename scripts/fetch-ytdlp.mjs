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
//  2. ffmpeg — "shared" build from yt-dlp/FFmpeg-Builds (Windows)
// ---------------------------------------------------------------------------
//  We use the SHARED build, not the full static one: its ffmpeg.exe and
//  ffprobe.exe are tiny (~few hundred KB each) and depend on sibling DLLs in
//  the same bin/ folder. Total is ~150 MB vs ~195 MB for a single static
//  ffmpeg.exe (and that one lacks ffprobe). We extract the whole bin/ folder
//  to electron/resources/ffmpeg/ so the exes + their DLLs travel together;
//  electron-builder bundles the folder and main.ts seeds it to
//  %APPDATA%\Yoink\ffmpeg\ on first launch.
//
//  Node has no built-in unzip, so on Windows we shell out to PowerShell's
//  Expand-Archive (this is a Windows build script). A flaky mirror produces a
//  clear error and non-zero exit without corrupting the yt-dlp we fetched.

const ffmpegDir = path.join(outDir, "ffmpeg");
const ffmpegZipUrl =
  "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl-shared.zip";

if (process.platform !== "win32") {
  console.warn("[fetch-ytdlp] skipping ffmpeg fetch (non-Windows build host)");
} else {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yoink-ffmpeg-"));
  const zipPath = path.join(tmpDir, "ffmpeg.zip");
  try {
    console.log(`[fetch-ytdlp] downloading ${ffmpegZipUrl}`);
    await download(ffmpegZipUrl, zipPath);
    console.log(`[fetch-ytdlp] extracting ffmpeg shared build (zip ${sizeMB(zipPath)} MB)`);

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

    // The zip's top-level dir is versioned (e.g. ffmpeg-master-...-shared/);
    // locate the bin/ folder that contains ffmpeg.exe + ffprobe.exe + DLLs.
    const ffmpegExe = findFile(tmpDir, "ffmpeg.exe");
    if (!ffmpegExe) throw new Error("ffmpeg.exe not found inside extracted archive");
    const binDir = path.dirname(ffmpegExe);
    if (!fs.existsSync(path.join(binDir, "ffprobe.exe"))) {
      throw new Error("ffprobe.exe not found beside ffmpeg.exe in the archive");
    }

    // Replace any prior contents, then copy the whole bin/ folder.
    fs.rmSync(ffmpegDir, { recursive: true, force: true });
    fs.mkdirSync(ffmpegDir, { recursive: true });
    fs.cpSync(binDir, ffmpegDir, { recursive: true });

    // Drop ffplay.exe + its SDL dependency — we never use it, and it pulls an
    // extra DLL. Best-effort; ignore if absent.
    for (const extra of ["ffplay.exe"]) {
      try { fs.rmSync(path.join(ffmpegDir, extra), { force: true }); } catch { /* ignore */ }
    }

    const total = dirSizeMB(ffmpegDir);
    console.log(`[fetch-ytdlp] wrote ${ffmpegDir}\\ (ffmpeg.exe + ffprobe.exe + DLLs, ${total} MB)`);
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

/** Total size in MB (1 decimal) of all files directly in `dir`. */
function dirSizeMB(dir) {
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) bytes += fs.statSync(path.join(dir, entry.name)).size;
  }
  return (bytes / 1024 / 1024).toFixed(1);
}
