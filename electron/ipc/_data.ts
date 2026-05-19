/**
 * Shared data helpers for IPC handlers.
 *
 * Single source of truth for where Yoink stores its JSON state on disk.
 * Mirrors `lib/data.ts` (used by the Next.js server) so the Electron
 * build and the Next.js dev server see the same files.
 *
 * Location:
 *   Windows:  %APPDATA%\Yoink\
 *   macOS:    ~/.yoink/
 *   Linux:    ~/.yoink/
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { HistoryEntry } from "@/lib/api-client";
import type { Settings } from "@/lib/types";

export function getDataDir(): string {
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "Yoink");
  }
  return path.join(os.homedir(), ".yoink");
}

function ensureDataDir(): string {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson<T>(filename: string, fallback: T): T {
  try {
    const p = path.join(getDataDir(), filename);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filename: string, data: unknown): void {
  ensureDataDir();
  fs.writeFileSync(path.join(getDataDir(), filename), JSON.stringify(data, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
//  History
// ---------------------------------------------------------------------------

export function readHistory(): HistoryEntry[] {
  return readJson<HistoryEntry[]>("history.json", []);
}

export function writeHistory(list: HistoryEntry[]): void {
  writeJson("history.json", list);
}

// ---------------------------------------------------------------------------
//  Settings
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: Settings = {
  outputDir: path.join(os.homedir(), "Downloads"),
  defaultMode: "video",
  defaultQuality: "best",
  embedMetadata: true,
  embedThumbnail: true,
  cookiesFile: "",
};

export function readSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>("settings.json", {}) };
}

export function writeSettings(s: Partial<Settings>): void {
  writeJson("settings.json", { ...DEFAULT_SETTINGS, ...s });
}
