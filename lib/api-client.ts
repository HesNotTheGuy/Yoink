/**
 * api-client.ts — single API surface used by every React page.
 *
 * Every function delegates to the Electron IPC bridge exposed on
 * `window.yoink` by `electron/preload.ts`. The Next.js API routes that
 * used to back these calls in dev mode have been removed; this build
 * only runs inside the Electron host.
 *
 * If the bridge is missing (e.g. someone loads the static export
 * directly in a browser) every call throws a clear error rather than
 * silently failing — see `requireElectron()` below.
 */

import type { Settings, Format } from "@/lib/types";

// ---------------------------------------------------------------------------
//  Types - the shared contract between renderer and main process.
//  These are deliberately defined here (not duplicated per call site) so the
//  TypeScript signatures match across the IPC boundary.
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  mode: string;
  outputDir: string;
  status: "done" | "error";
  completedAt: number;
  error?: string;
}

export interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number | null;
  uploader: string;
}

export interface DownloadRequest {
  url: string;
  mode: "video" | "audio";
  quality: string;
  formatId?: string;
  outputDir: string;
  thumbnail?: string;
  embedMetadata?: boolean;
  embedThumbnail?: boolean;
  cookiesFile?: string;
  speedLimit?: string;
  subtitles?: { enabled: boolean; lang?: string; embed?: boolean };
}

export interface TrimRequest {
  input: string;
  inSec: number;
  outSec: number;
  output?: string;
  copyStreams?: boolean;
}

export interface CutRequest {
  input: string;
  segments: { start: number; end: number }[];
  output?: string;
}

export interface AudioTrimRequest {
  input: string;
  inSec: number;
  outSec: number;
  codec: "mp3" | "wav" | "flac" | "aac";
  output?: string;
}

/**
 * Streaming progress event from any of the long-running operations
 * (download, trim, cut, trim-audio).
 */
export type ProgressEvent =
  | { type: "start"; duration?: number; output?: string }
  | { type: "progress"; percent: number; speed?: string; eta?: string }
  | { type: "title"; title: string }
  | { type: "log"; text: string }
  | { type: "done"; output?: string }
  | { type: "error"; message: string };

/**
 * The shape of the API exposed by Electron's preload script as `window.yoink`.
 * Mirror this exactly in `electron/preload.ts` and again in the IPC handlers.
 */
export interface YoinkApi {
  // Metadata
  getInfo(url: string): Promise<VideoInfo>;
  getFormats(url: string): Promise<Format[]>;
  // History
  getHistory(): Promise<HistoryEntry[]>;
  addHistory(entry: HistoryEntry): Promise<void>;
  clearHistory(): Promise<void>;
  // Settings
  getSettings(): Promise<Settings>;
  saveSettings(s: Partial<Settings>): Promise<void>;
  // Downloads (streaming)
  startDownload(req: DownloadRequest, onEvent: (e: ProgressEvent) => void): Promise<string>; // returns download id
  cancelDownload(id: string): Promise<void>;
  // Editor operations (all streaming)
  trim(req: TrimRequest, onEvent: (e: ProgressEvent) => void): Promise<void>;
  cut(req: CutRequest, onEvent: (e: ProgressEvent) => void): Promise<void>;
  trimAudio(req: AudioTrimRequest, onEvent: (e: ProgressEvent) => void): Promise<void>;
  // yt-dlp lifecycle
  checkYtdlpUpdate(): Promise<{ current: string; latest: string; updateAvailable: boolean }>;
  updateYtdlp(onLog: (line: string) => void): Promise<void>;
  // File system
  pickFolder(): Promise<string | null>;
  openFolder(path: string): Promise<void>;
  // Local file streaming (for video preview in editor)
  localFileUrl(absolutePath: string): string;
}

declare global {
  interface Window {
    yoink?: YoinkApi;
  }
}

// ---------------------------------------------------------------------------
//  Bridge guard - every call goes through here so a missing bridge
//  surfaces as a comprehensible error instead of a `Cannot read properties
//  of undefined` deep in the call site.
// ---------------------------------------------------------------------------

function requireElectron(): YoinkApi {
  if (typeof window === "undefined" || !window.yoink) {
    throw new Error(
      "Yoink Electron bridge not available - this build requires running inside the Electron host."
    );
  }
  return window.yoink;
}

// ---------------------------------------------------------------------------
//  Public API - what pages import.
// ---------------------------------------------------------------------------

export async function getInfo(url: string): Promise<VideoInfo> {
  return requireElectron().getInfo(url);
}

export async function getFormats(url: string): Promise<Format[]> {
  return requireElectron().getFormats(url);
}

export async function getHistory(): Promise<HistoryEntry[]> {
  return requireElectron().getHistory();
}

export async function addHistory(entry: HistoryEntry): Promise<void> {
  return requireElectron().addHistory(entry);
}

export async function clearHistory(): Promise<void> {
  return requireElectron().clearHistory();
}

export async function getSettings(): Promise<Settings> {
  return requireElectron().getSettings();
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  return requireElectron().saveSettings(s);
}

export async function pickFolder(): Promise<string | null> {
  return requireElectron().pickFolder();
}

export async function openFolder(path: string): Promise<void> {
  return requireElectron().openFolder(path);
}

export async function checkYtdlpUpdate() {
  return requireElectron().checkYtdlpUpdate();
}

/**
 * Returns the URL the renderer should use to load a local file in
 * <video src=...>. The Electron main process registers a `yoink-file://`
 * protocol handler that streams the bytes back to the renderer.
 */
export function localFileUrl(absolutePath: string): string {
  return requireElectron().localFileUrl(absolutePath);
}

export async function trim(req: TrimRequest, onEvent: (e: ProgressEvent) => void): Promise<void> {
  return requireElectron().trim(req, onEvent);
}

export async function cut(req: CutRequest, onEvent: (e: ProgressEvent) => void): Promise<void> {
  return requireElectron().cut(req, onEvent);
}

export async function trimAudio(
  req: AudioTrimRequest,
  onEvent: (e: ProgressEvent) => void
): Promise<void> {
  return requireElectron().trimAudio(req, onEvent);
}

/**
 * Start a download. Returns the download id (used to cancel).
 * The IPC handler streams events on a unique channel while running yt-dlp.
 */
export async function startDownload(
  req: DownloadRequest,
  onEvent: (e: ProgressEvent) => void
): Promise<string> {
  return requireElectron().startDownload(req, onEvent);
}

export async function cancelDownload(id: string): Promise<void> {
  return requireElectron().cancelDownload(id);
}

/**
 * Streaming yt-dlp updater. Each log line from `yt-dlp -U` is passed
 * to `onLog`. Resolves when the update process exits.
 */
export async function updateYtdlp(onLog: (line: string) => void): Promise<void> {
  return requireElectron().updateYtdlp(onLog);
}
