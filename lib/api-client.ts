/**
 * api-client.ts — single API surface used by every React page.
 *
 * Each function prefers the Electron IPC bridge (`window.yoink.*`) when
 * present, and falls back to `fetch('/api/...')` against the Next.js
 * server otherwise. That lets the same renderer code work in:
 *   - the Next.js dev server (browser, no Electron)
 *   - the Electron production build (no Next.js server)
 *
 * During the v2 → v3 migration, handlers will be added to the Electron
 * preload one by one. The fetch fallback keeps the app working through
 * the whole transition - no big-bang switch.
 *
 * Once every handler is ported and the Electron build is the only
 * shipped artifact, the fetch fallbacks can be deleted and the
 * Next.js API routes can be removed.
 */

import type { Settings } from "@/app/api/settings/route";
import type { Format } from "@/app/api/formats/route";

// ---------------------------------------------------------------------------
//  Types - the shared contract between renderer and main process / API route.
//  These are deliberately defined here (not duplicated per call site) so the
//  TypeScript signatures match across the IPC and fetch paths.
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

const isElectron = (): boolean =>
  typeof window !== "undefined" && typeof window.yoink !== "undefined";

// ---------------------------------------------------------------------------
//  Public API - what pages import. Each function chooses IPC or fetch.
// ---------------------------------------------------------------------------

export async function getInfo(url: string): Promise<VideoInfo> {
  if (isElectron()) return window.yoink!.getInfo(url);
  const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error("Could not fetch info");
  return res.json();
}

export async function getFormats(url: string): Promise<Format[]> {
  if (isElectron()) return window.yoink!.getFormats(url);
  const res = await fetch(`/api/formats?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error("Could not fetch formats");
  const { formats } = await res.json();
  return formats;
}

export async function getHistory(): Promise<HistoryEntry[]> {
  if (isElectron()) return window.yoink!.getHistory();
  const res = await fetch("/api/history");
  return res.json();
}

export async function addHistory(entry: HistoryEntry): Promise<void> {
  if (isElectron()) return window.yoink!.addHistory(entry);
  await fetch("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
}

export async function clearHistory(): Promise<void> {
  if (isElectron()) return window.yoink!.clearHistory();
  await fetch("/api/history", { method: "DELETE" });
}

export async function getSettings(): Promise<Settings> {
  if (isElectron()) return window.yoink!.getSettings();
  const res = await fetch("/api/settings");
  return res.json();
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  if (isElectron()) return window.yoink!.saveSettings(s);
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(s),
  });
}

export async function pickFolder(): Promise<string | null> {
  if (isElectron()) return window.yoink!.pickFolder();
  const res = await fetch("/api/pick-folder", { method: "POST" });
  const { path } = await res.json();
  return path ?? null;
}

export async function openFolder(path: string): Promise<void> {
  if (isElectron()) return window.yoink!.openFolder(path);
  await fetch("/api/open-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export async function checkYtdlpUpdate() {
  if (isElectron()) return window.yoink!.checkYtdlpUpdate();
  const res = await fetch("/api/check-update");
  return res.json();
}

/**
 * Returns the URL the renderer should use to load a local file in
 * <video src=...>. In Electron we use a custom protocol; in Next.js
 * dev we use the local-file API route.
 */
export function localFileUrl(absolutePath: string): string {
  if (isElectron()) return window.yoink!.localFileUrl(absolutePath);
  return `/api/local-file?path=${encodeURIComponent(absolutePath)}`;
}

/**
 * Generic helper to consume a Server-Sent-Events stream from a Next.js
 * /api route and fan it out to a callback. Used by the fetch fallback
 * for download/trim/cut/audio.
 */
async function consumeSseStream(
  res: Response,
  onEvent: (e: ProgressEvent) => void
): Promise<void> {
  if (!res.body) throw new Error("No stream body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const ev of events) {
      const line = ev.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        /* swallow malformed events */
      }
    }
  }
}

export async function trim(req: TrimRequest, onEvent: (e: ProgressEvent) => void): Promise<void> {
  if (isElectron()) return window.yoink!.trim(req, onEvent);
  const res = await fetch("/api/trim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error("Trim failed");
  await consumeSseStream(res, onEvent);
}

export async function cut(req: CutRequest, onEvent: (e: ProgressEvent) => void): Promise<void> {
  if (isElectron()) return window.yoink!.cut(req, onEvent);
  const res = await fetch("/api/cut", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error("Cut failed");
  await consumeSseStream(res, onEvent);
}

export async function trimAudio(
  req: AudioTrimRequest,
  onEvent: (e: ProgressEvent) => void
): Promise<void> {
  if (isElectron()) return window.yoink!.trimAudio(req, onEvent);
  const res = await fetch("/api/trim-audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error("Audio trim failed");
  await consumeSseStream(res, onEvent);
}
