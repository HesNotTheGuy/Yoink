/**
 * ffmpeg utilities — finder + arg builders for trim/cut/concat operations.
 * Mirrors the structure of lib/ytdlp.ts so the editor API routes stay clean.
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
 * Finds the ffmpeg executable.
 *
 * Search order:
 *   1. %APPDATA%\Yoink\ffmpeg.exe (shared with extension + Premiere plugin)
 *   2. Sibling of the portable build: <app>/ffmpeg/ffmpeg.exe
 *   3. PATH fallback
 */
export function findFfmpeg(): string {
  const exeName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  // 1. Shared Yoink data dir
  const dataDir = process.env.APPDATA
    ? path.join(process.env.APPDATA, "Yoink")
    : path.join(os.homedir(), ".yoink");
  const shared = path.join(dataDir, exeName);
  if (fs.existsSync(shared)) return shared;

  // 2. Portable build sibling — when running the standalone server, the
  //    launcher prepends <app>/ffmpeg to PATH; we still resolve here as a
  //    belt-and-suspenders check for dev runs.
  const cwdSibling = path.join(process.cwd(), "ffmpeg", exeName);
  if (fs.existsSync(cwdSibling)) return cwdSibling;

  // 3. PATH
  return exeName;
}

/**
 * Returns the ffmpeg version string (the first line of `ffmpeg -version`),
 * or throws if not found.
 */
export async function getFfmpegVersion(): Promise<string> {
  const { stdout } = await execFileAsync(findFfmpeg(), ["-version"], { timeout: 5_000 });
  return stdout.split("\n")[0].trim();
}

// ---------------------------------------------------------------------------
//  Time formatting (seconds <-> ffmpeg timestamp)
// ---------------------------------------------------------------------------

/**
 * Converts a number of seconds to an ffmpeg timestamp: HH:MM:SS.mmm.
 * Accepts non-integer seconds (millisecond precision preserved).
 */
export function secondsToTimestamp(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec - h * 3600 - m * 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
//  Arg builders
// ---------------------------------------------------------------------------

export interface TrimArgsInput {
  input: string;
  output: string;
  /** Start time in seconds (inclusive) */
  inSec: number;
  /** End time in seconds (exclusive) */
  outSec: number;
  /**
   * When true, stream-copy without re-encoding (fast, lossless, but cuts
   * may snap to nearest keyframe). When false, re-encode for frame-accurate
   * cuts at the cost of speed and a small quality hit.
   */
  copyStreams?: boolean;
}

/**
 * Builds ffmpeg args for a single-segment trim.
 * Uses `-ss` before `-i` for fast seeking, with `-to` (absolute end time
 * relative to the new clip's zero point — that's why we add the duration).
 */
export function buildTrimArgs(opts: TrimArgsInput): string[] {
  const duration = Math.max(0, opts.outSec - opts.inSec);
  const args = [
    "-y", // overwrite output
    "-ss", secondsToTimestamp(opts.inSec),
    "-i", opts.input,
    "-t", duration.toFixed(3),
  ];
  if (opts.copyStreams !== false) {
    args.push("-c", "copy", "-avoid_negative_ts", "make_zero");
  }
  // Progress output to stdout for streaming
  args.push("-progress", "pipe:1", "-nostats");
  args.push(opts.output);
  return args;
}

/**
 * Multi-segment cut/concat. `segments` is the list of kept ranges (in source
 * timeline order). ffmpeg's concat demuxer requires a temporary list file,
 * which the caller is responsible for writing and deleting.
 *
 * Returns args for `ffmpeg -f concat -safe 0 -i <listFile> -c copy <output>`.
 */
export function buildConcatArgs(listFile: string, output: string): string[] {
  return [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-c", "copy",
    "-progress", "pipe:1", "-nostats",
    output,
  ];
}

/**
 * Audio-only trim. Re-encodes to the chosen codec.
 * codec: "mp3" | "wav" | "flac" | "aac"
 */
export interface AudioTrimInput {
  input: string;
  output: string;
  inSec: number;
  outSec: number;
  codec: "mp3" | "wav" | "flac" | "aac";
}

export function buildAudioTrimArgs(opts: AudioTrimInput): string[] {
  const duration = Math.max(0, opts.outSec - opts.inSec);
  const args = [
    "-y",
    "-ss", secondsToTimestamp(opts.inSec),
    "-i", opts.input,
    "-t", duration.toFixed(3),
    "-vn", // strip video
  ];

  switch (opts.codec) {
    case "mp3":
      args.push("-c:a", "libmp3lame", "-q:a", "2"); // VBR ~190 kbps
      break;
    case "wav":
      args.push("-c:a", "pcm_s16le");
      break;
    case "flac":
      args.push("-c:a", "flac");
      break;
    case "aac":
      args.push("-c:a", "aac", "-b:a", "192k");
      break;
  }

  args.push("-progress", "pipe:1", "-nostats", opts.output);
  return args;
}

// ---------------------------------------------------------------------------
//  Progress parsing
// ---------------------------------------------------------------------------

/**
 * ffmpeg's `-progress pipe:1 -nostats` emits key=value pairs followed by
 * `progress=continue` or `progress=end`. Returns the most useful subset
 * we care about for UI: out_time (microseconds → seconds) and speed.
 */
export interface FfmpegProgress {
  outTimeSec: number | null;
  speed: string | null;
  done: boolean;
}

const RE_KV = /^(\w+)=(.+)$/;

export function parseProgressBlock(text: string): FfmpegProgress {
  let outTimeSec: number | null = null;
  let speed: string | null = null;
  let done = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const m = RE_KV.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "out_time_us" || key === "out_time_ms") {
      const n = parseInt(value, 10);
      if (!isNaN(n)) {
        // out_time_us is microseconds; out_time_ms is also microseconds
        // despite the name (ffmpeg quirk). Both → seconds via /1e6.
        outTimeSec = n / 1_000_000;
      }
    } else if (key === "speed") {
      speed = value;
    } else if (key === "progress") {
      done = value === "end";
    }
  }
  return { outTimeSec, speed, done };
}
