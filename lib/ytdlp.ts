/**
 * yt-dlp utilities — single source of truth for finding the binary and
 * building the args passed to it. Used by every API route that shells
 * out to yt-dlp so the format/subtitle/progress logic doesn't drift.
 */

import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import { parseInputUrl } from "@/lib/youtube-url";

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
 * Calls `yt-dlp` via `buildProbeArgs` (`--dump-json --no-download --no-playlist`)
 * and returns the parsed JSON of the first object line. Throws on failure.
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

  const runtime = findJsRuntime();
  const { stdout } = await execFileAsync(
    findYtdlp(),
    buildProbeArgs({ url, jsRuntime: runtime }),
    { timeout, maxBuffer: 32 * 1024 * 1024, env: ytdlpProcessEnv(runtime) }
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

// Shorts labeled "1080p" are often 1080x1920. height<=1080 would drop the
// full-quality vertical stream. Cap width instead, and always fall back to /best.
const SHORTS_QUALITY_FORMAT_MAP: Record<string, string> = {
  best:    "bestvideo+bestaudio/best",
  "1080p": "bestvideo[width<=1080][height<=1920]+bestaudio/best[width<=1080][height<=1920]/best",
  "720p":  "bestvideo[width<=720][height<=1280]+bestaudio/best[width<=720][height<=1280]/best",
  "480p":  "bestvideo[width<=480][height<=854]+bestaudio/best[width<=480][height<=854]/best",
  "360p":  "bestvideo[width<=360][height<=640]+bestaudio/best[width<=360][height<=640]/best",
};

export type YoutubeUrlKind = "youtube-short" | "other";

export type FormatArgsInput = Pick<
  DownloadArgsInput,
  "mode" | "quality" | "formatId" | "embedMetadata" | "embedThumbnail"
> & {
  urlKind?: YoutubeUrlKind;
};

/**
 * Builds the format/quality args portion of a yt-dlp call.
 * Does NOT include the URL, output template, or generic flags like --newline.
 */
export function buildFormatArgs(opts: FormatArgsInput): string[] {
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

  if (opts.formatId && opts.formatId !== "bestvideo+bestaudio/best") {
    args.push("-f", opts.formatId);
  } else if (opts.urlKind === "youtube-short") {
    args.push("-f", SHORTS_QUALITY_FORMAT_MAP[opts.quality] ?? SHORTS_QUALITY_FORMAT_MAP.best);
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

export type JsRuntime = {
  kind: "deno" | "node";
  executable: string;
  /**
   * The executable is the Electron binary. yt-dlp must be spawned with
   * ELECTRON_RUN_AS_NODE=1 so the child it starts behaves as Node.
   */
  electronAsNode?: boolean;
};

/** Current yt-dlp rejects Deno older than this for challenge scripts. */
export const MIN_DENO_FOR_YTDLP = [2, 3, 0] as const;
/** Current yt-dlp rejects Node older than this for challenge scripts. */
export const MIN_NODE_FOR_YTDLP = [22, 0, 0] as const;

export interface RuntimeCandidate {
  executable: string;
  versionText: string;
}

/** First x.y.z in a `--version` string, or null when none is present. */
export function parseDottedVersion(text: string): number[] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function versionAtLeast(version: readonly number[], minimum: readonly number[]): boolean {
  for (let i = 0; i < minimum.length; i++) {
    const part = version[i] ?? 0;
    const min = minimum[i] ?? 0;
    if (part > min) return true;
    if (part < min) return false;
  }
  return true;
}

/**
 * Pick a runtime current yt-dlp will actually use. Deno is preferred.
 * A Node binary older than 22 is ignored. Electron's own Node is the
 * fallback when nothing else qualifies, because a normal install does
 * not ship Deno or a separate Node.
 */
export function selectJsRuntime(input: {
  deno: RuntimeCandidate | null;
  node: RuntimeCandidate | null;
  electronNode: RuntimeCandidate | null;
}): JsRuntime | null {
  const denoVersion = input.deno ? parseDottedVersion(input.deno.versionText) : null;
  if (input.deno && denoVersion && versionAtLeast(denoVersion, MIN_DENO_FOR_YTDLP)) {
    return { kind: "deno", executable: input.deno.executable };
  }
  const nodeVersion = input.node ? parseDottedVersion(input.node.versionText) : null;
  if (input.node && nodeVersion && versionAtLeast(nodeVersion, MIN_NODE_FOR_YTDLP)) {
    return { kind: "node", executable: input.node.executable };
  }
  const electronVersion = input.electronNode ? parseDottedVersion(input.electronNode.versionText) : null;
  if (input.electronNode && electronVersion && versionAtLeast(electronVersion, MIN_NODE_FOR_YTDLP)) {
    return { kind: "node", executable: input.electronNode.executable, electronAsNode: true };
  }
  return null;
}

/** Environment for a yt-dlp child. Electron-as-Node must be inherited by the runtime yt-dlp spawns. */
export function ytdlpProcessEnv(runtime: JsRuntime | null): NodeJS.ProcessEnv {
  if (!runtime?.electronAsNode) return process.env;
  return { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
}

export function buildJsRuntimeArgs(runtime: JsRuntime | null): string[] {
  if (!runtime) return [];
  return ["--js-runtimes", `${runtime.kind}:${runtime.executable}`];
}

/** True when `--help` documents `--js-runtimes`. The `--no-` form must not match. */
export function jsRuntimesFlagSupported(helpText: string): boolean {
  return /(?:^|\s)--js-runtimes\b/m.test(helpText);
}

let cachedJsRuntimesSupport: boolean | undefined;

function ytdlpSupportsJsRuntimesFlag(): boolean {
  if (cachedJsRuntimesSupport !== undefined) return cachedJsRuntimesSupport;
  try {
    const help = execFileSync(findYtdlp(), ["--help"], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    cachedJsRuntimesSupport = jsRuntimesFlagSupported(help);
  } catch {
    cachedJsRuntimesSupport = false;
  }
  return cachedJsRuntimesSupport;
}

function findExecutableOnPath(exe: string): string | null {
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function runtimeVersionText(executable: string, env?: NodeJS.ProcessEnv): string | null {
  try {
    return execFileSync(executable, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
      env,
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function firstExisting(candidates: Array<string | null>): string | null {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Prefer a new enough Deno, then a new enough Node, then Electron's Node.
 * Look beside yt-dlp, then on PATH. A pinned yt-dlp from before
 * `--js-runtimes` gets no runtime flag: seedBundledYtdlp does not
 * overwrite an existing binary, and that flag would make it exit 2.
 */
export function findJsRuntime(): JsRuntime | null {
  if (!ytdlpSupportsJsRuntimesFlag()) return null;
  const ytdlp = findYtdlp();
  const besideDir = path.isAbsolute(ytdlp) ? path.dirname(ytdlp) : null;
  const denoName = process.platform === "win32" ? "deno.exe" : "deno";
  const nodeName = process.platform === "win32" ? "node.exe" : "node";

  const denoPath = firstExisting([
    besideDir ? path.join(besideDir, denoName) : null,
    findExecutableOnPath(denoName),
  ]);
  const nodePath = firstExisting([
    besideDir ? path.join(besideDir, nodeName) : null,
    findExecutableOnPath(nodeName),
  ]);
  const denoVersion = denoPath ? runtimeVersionText(denoPath) : null;
  const nodeVersion = nodePath ? runtimeVersionText(nodePath) : null;

  let electronNode: RuntimeCandidate | null = null;
  if (process.versions.electron) {
    const versionText = runtimeVersionText(process.execPath, {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    });
    if (versionText) electronNode = { executable: process.execPath, versionText };
  }

  return selectJsRuntime({
    deno: denoPath && denoVersion ? { executable: denoPath, versionText: denoVersion } : null,
    node: nodePath && nodeVersion ? { executable: nodePath, versionText: nodeVersion } : null,
    electronNode,
  });
}

export function buildProbeArgs(opts: { url: string; jsRuntime?: JsRuntime | null }): string[] {
  const runtime = opts.jsRuntime === undefined ? findJsRuntime() : opts.jsRuntime;
  return [
    "--dump-json",
    "--no-download",
    "--no-playlist",
    ...buildJsRuntimeArgs(runtime),
    "--",
    opts.url,
  ];
}

export interface BuildDownloadArgvInput {
  url: string;
  mode: DownloadMode;
  quality: string;
  formatId?: string;
  embedMetadata?: boolean;
  embedThumbnail?: boolean;
  cookiesFile?: string;
  speedLimit?: string;
  subtitles?: SubtitleOptions;
  outputTemplate: string;
  ffmpegLocation?: string;
  jsRuntime?: JsRuntime | null;
}

export function buildDownloadArgv(opts: BuildDownloadArgvInput): string[] {
  const parsed = parseInputUrl(opts.url);
  const urlKind: YoutubeUrlKind = parsed?.kind === "youtube-short" ? "youtube-short" : "other";
  const runtime = opts.jsRuntime === undefined ? findJsRuntime() : opts.jsRuntime;
  const ffmpegArgs = opts.ffmpegLocation
    ? ["--ffmpeg-location", opts.ffmpegLocation]
    : [];
  return [
    ...buildFormatArgs({
      mode: opts.mode,
      quality: opts.quality,
      formatId: opts.formatId,
      embedMetadata: opts.embedMetadata,
      embedThumbnail: opts.embedThumbnail,
      urlKind,
    }),
    ...buildSubtitleArgs(opts.subtitles, opts.mode),
    ...ffmpegArgs,
    ...buildJsRuntimeArgs(runtime),
    ...(urlKind === "youtube-short" ? ["--no-playlist"] : []),
    ...buildTailArgs({
      cookiesFile: opts.cookiesFile,
      speedLimit: opts.speedLimit,
      outputTemplate: opts.outputTemplate,
    }),
    // `--print` implies `--quiet`, which hides `[download]` percent lines the UI parses.
    "--print",
    "after_move:[YOINK_PATH]%(filepath)s",
    "--no-simulate",
    "--progress",
    "--",
    opts.url,
  ];
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
