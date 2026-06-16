/**
 * yt-dlp utilities — single source of truth for finding the binary and
 * building the args passed to it. Used by every API route that shells
 * out to yt-dlp so the format/subtitle/progress logic doesn't drift.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
//  Binary lookup
// ---------------------------------------------------------------------------

/**
 * Finds the yt-dlp executable.
 * Checks %APPDATA%\Yoink\yt-dlp.exe first (shared location used by the
 * browser extension helper), then falls back to whatever is on PATH.
 */
export function findYtdlp(): string {
  const dataDir = process.env.APPDATA
    ? path.join(process.env.APPDATA, "Yoink")
    : path.join(os.homedir(), ".yoink");

  const sharedExe = path.join(dataDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  if (fs.existsSync(sharedExe)) return sharedExe;

  return process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
}

/**
 * Returns true if a yt-dlp binary can be located at the resolved path.
 * When findYtdlp() falls back to a bare exe name (i.e. relies on PATH),
 * we resolve it against PATH; if even that fails we return false so callers
 * can surface a friendly "not found" message instead of an opaque ENOENT.
 */
export function ytdlpExists(): boolean {
  const resolved = findYtdlp();
  // Absolute path → check it directly.
  if (path.isAbsolute(resolved)) return fs.existsSync(resolved);
  // Bare name → walk PATH for it.
  return resolveOnPath(resolved);
}

/** Returns true if `exe` is found in any directory listed on PATH. */
function resolveOnPath(exe: string): boolean {
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    if (fs.existsSync(path.join(dir, exe))) return true;
  }
  return false;
}

/**
 * Returns the yt-dlp version string, or throws if not found.
 */
export async function getYtdlpVersion(): Promise<string> {
  const { stdout } = await execFileAsync(findYtdlp(), ["--version"], { timeout: 5_000 });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
//  Metadata extraction — used by /api/info and /api/formats
// ---------------------------------------------------------------------------

/**
 * Calls `yt-dlp --dump-json --no-download --no-playlist <url>` and returns
 * the parsed JSON of the first line (the video metadata). Throws on failure.
 *
 * maxBuffer is intentionally large: yt-dlp's JSON dump for a YouTube video
 * routinely runs 500 KB - 2 MB once every format variant is included, and
 * playlists / livestreams / high-format-count uploads can push 5+ MB. The
 * Node default of 1 MB silently rejects with ERR_CHILD_PROCESS_STDIO_MAXBUFFER
 * which surfaces in the UI as "could not load video info".
 */
export async function dumpJson(url: string, timeout = 30_000): Promise<Record<string, unknown>> {
  if (!ytdlpExists()) {
    throw new Error("yt-dlp not found. Click 'Update yt-dlp' or reinstall Yoink.");
  }

  const { stdout } = await execFileAsync(
    findYtdlp(),
    // The "--" sentinel stops yt-dlp from interpreting a URL that begins
    // with "-" as a flag (argument injection guard).
    ["--dump-json", "--no-download", "--no-playlist", "--", url],
    { timeout, maxBuffer: 32 * 1024 * 1024 }
  );

  // yt-dlp can print warning lines on stdout before the JSON payload, so we
  // can't blindly parse the first line. Find the first line that looks like a
  // JSON object instead.
  const jsonLine = stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("{"));
  if (!jsonLine) {
    throw new Error("yt-dlp returned no JSON metadata (no object line found in output).");
  }
  return JSON.parse(jsonLine);
}

// ---------------------------------------------------------------------------
//  Download argument builders
// ---------------------------------------------------------------------------

export type DownloadMode = "video" | "audio";

export interface DownloadArgsInput {
  mode: DownloadMode;
  quality: string;
  /** Optional explicit format ID — overrides quality preset when set */
  formatId?: string;
  embedMetadata?: boolean;
  embedThumbnail?: boolean;
  cookiesFile?: string;
  speedLimit?: string;
  /** Subtitles — when provided, adds --write-subs etc. */
  subtitles?: SubtitleOptions;
}

export interface SubtitleOptions {
  enabled: boolean;
  /** ISO language code(s) — e.g. "en", "en,fr", "all". Defaults to "en" */
  lang?: string;
  /** Embed into video container (mp4/mkv) vs save as .srt sidecar */
  embed?: boolean;
}

const QUALITY_FORMAT_MAP: Record<string, string> = {
  best:   "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
  "1080p":"bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]",
  "720p": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]",
  "480p": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]",
  "360p": "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]",
};

/**
 * Builds the format/quality args portion of a yt-dlp call.
 * Does NOT include the URL, output template, or generic flags like --newline.
 */
export function buildFormatArgs(opts: Pick<DownloadArgsInput, "mode" | "quality" | "formatId" | "embedMetadata" | "embedThumbnail">): string[] {
  const args: string[] = [];

  if (opts.mode === "audio") {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
    if (opts.formatId && opts.formatId !== "bestvideo+bestaudio/best") {
      args.push("-f", opts.formatId);
    }
    if (opts.embedMetadata) args.push("--embed-metadata");
    if (opts.embedThumbnail) args.push("--embed-thumbnail");
    return args;
  }

  // Video
  if (opts.formatId && opts.formatId !== "bestvideo+bestaudio/best") {
    args.push("-f", opts.formatId);
  } else {
    args.push("-f", QUALITY_FORMAT_MAP[opts.quality] ?? QUALITY_FORMAT_MAP.best);
  }
  args.push("--merge-output-format", "mp4");
  if (opts.embedMetadata) args.push("--embed-metadata", "--embed-chapters");
  return args;
}

/**
 * Builds subtitle args. Returns empty array when subtitles are disabled
 * or not requested. Embed mode is only honored for video downloads and
 * yt-dlp itself silently ignores --embed-subs for incompatible containers.
 */
export function buildSubtitleArgs(subs: SubtitleOptions | undefined, mode: DownloadMode): string[] {
  if (!subs || !subs.enabled) return [];
  const lang = subs.lang?.trim() || "en";
  const args = ["--write-subs", "--write-auto-subs", "--sub-langs", lang];
  if (subs.embed && mode === "video") {
    args.push("--embed-subs");
  } else {
    args.push("--convert-subs", "srt");
  }
  return args;
}

/**
 * Builds the "tail" args: cookies, rate limiting, and the output template.
 * Caller appends these plus the URL after the format/subtitle args.
 */
export function buildTailArgs(opts: { cookiesFile?: string; speedLimit?: string; outputTemplate: string }): string[] {
  const args: string[] = [];
  if (opts.cookiesFile) args.push("--cookies", opts.cookiesFile);
  if (opts.speedLimit) args.push("--limit-rate", opts.speedLimit);
  args.push("--newline", "-o", opts.outputTemplate);
  return args;
}

// ---------------------------------------------------------------------------
//  Progress parsing
// ---------------------------------------------------------------------------

const RE_PROGRESS = /\[download\]\s+([\d.]+)%\s+of\s+[\d.]+\S+\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/;
const RE_TITLE = /\[(?:download|info)\].*Destination:\s*.*[/\\](.+)$/;

export interface ProgressUpdate {
  progress: number;
  speed: string;
  eta: string;
}

/**
 * Parses a single line of yt-dlp stdout. Returns the progress update if the
 * line is a `[download] X% of Y at Z ETA W` line, or null otherwise.
 */
export function parseProgressLine(line: string): ProgressUpdate | null {
  const m = line.match(RE_PROGRESS);
  if (!m) return null;
  return { progress: parseFloat(m[1]), speed: m[2], eta: m[3] };
}

/**
 * Parses a `[download] Destination: <path>` line and returns the filename
 * portion, or null if the line doesn't match.
 */
export function parseTitleLine(line: string): string | null {
  const m = line.match(RE_TITLE);
  return m ? m[1] : null;
}
