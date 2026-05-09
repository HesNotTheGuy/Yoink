import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

/**
 * Finds the yt-dlp executable.
 * Checks %APPDATA%\Yoink\yt-dlp.exe first (shared location used by the
 * browser extension helper), then falls back to whatever is on PATH.
 */
export function findYtdlp(): string {
  // 1. Shared data dir (Windows: %APPDATA%\Yoink, Mac/Linux: ~/.yoink)
  const dataDir = process.env.APPDATA
    ? path.join(process.env.APPDATA, "Yoink")
    : path.join(os.homedir(), ".yoink");

  const sharedExe = path.join(dataDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  if (fs.existsSync(sharedExe)) return sharedExe;

  // 2. Fall back to PATH
  return process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
}

/**
 * Returns the yt-dlp version string, or throws if not found.
 */
export async function getYtdlpVersion(): Promise<string> {
  const { stdout } = await execFileAsync(findYtdlp(), ["--version"], { timeout: 5_000 });
  return stdout.trim();
}
