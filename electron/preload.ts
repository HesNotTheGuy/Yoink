/**
 * Electron preload script — exposes a `window.yoink` API to the renderer.
 *
 * Everything the renderer needs goes through this bridge, never directly
 * through Node.js. `contextBridge.exposeInMainWorld` keeps the renderer
 * safely sandboxed (no `require`, no global Node access) while still
 * giving it typed access to specific IPC channels.
 *
 * The shape of this object MUST match `YoinkApi` in `lib/api-client.ts`.
 * If you add a method here, also add it there (and vice versa).
 */

import { contextBridge, ipcRenderer } from "electron";

// Streaming operations (download, trim, cut, trim-audio) push events back
// via a dedicated channel keyed by a unique stream ID we generate per call.
// The main process emits `yoink:stream:<id>` events; we route them to the
// caller's `onEvent` callback and clean up the listener when the stream
// signals done or error.
function streamingCall<TResult>(
  channel: string,
  payload: unknown,
  onEvent: (e: unknown) => void
): Promise<TResult> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const eventName = `yoink:stream:${id}`;

  const listener = (_e: Electron.IpcRendererEvent, msg: unknown) => onEvent(msg);
  ipcRenderer.on(eventName, listener);

  return ipcRenderer
    .invoke(channel, { ...(payload as object), __streamId: id })
    .finally(() => {
      ipcRenderer.removeListener(eventName, listener);
    }) as Promise<TResult>;
}

const yoinkApi = {
  // ─── Metadata ─────────────────────────────────────────────────────
  getInfo: (url: string) => ipcRenderer.invoke("info:get", url),
  getFormats: (url: string) => ipcRenderer.invoke("formats:get", url),

  // ─── History ──────────────────────────────────────────────────────
  getHistory: () => ipcRenderer.invoke("history:get"),
  addHistory: (entry: unknown) => ipcRenderer.invoke("history:add", entry),
  clearHistory: () => ipcRenderer.invoke("history:clear"),

  // ─── Settings ─────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (s: unknown) => ipcRenderer.invoke("settings:save", s),

  // ─── Downloads (streaming) ────────────────────────────────────────
  startDownload: (req: unknown, onEvent: (e: unknown) => void) =>
    streamingCall<string>("download:start", req, onEvent),
  cancelDownload: (id: string) => ipcRenderer.invoke("download:cancel", id),

  // ─── Editor (streaming) ───────────────────────────────────────────
  trim: (req: unknown, onEvent: (e: unknown) => void) =>
    streamingCall<void>("trim:run", req, onEvent),
  cut: (req: unknown, onEvent: (e: unknown) => void) =>
    streamingCall<void>("cut:run", req, onEvent),
  trimAudio: (req: unknown, onEvent: (e: unknown) => void) =>
    streamingCall<void>("trim-audio:run", req, onEvent),

  // ─── yt-dlp lifecycle ─────────────────────────────────────────────
  checkYtdlpUpdate: () => ipcRenderer.invoke("ytdlp:check-update"),
  updateYtdlp: (onLog: (line: string) => void) =>
    streamingCall<void>("ytdlp:update", {}, (e: unknown) => {
      const msg = e as { type?: string; text?: string };
      if (msg.type === "log" && typeof msg.text === "string") onLog(msg.text);
    }),

  // ─── File system ──────────────────────────────────────────────────
  pickFolder: () => ipcRenderer.invoke("folder:pick"),
  openFolder: (p: string) => ipcRenderer.invoke("folder:open", p),

  // ─── Local file URL helper ────────────────────────────────────────
  // Synchronous - just builds a URL. The yoink-file:// protocol is
  // registered in main.ts to stream the actual bytes when the renderer
  // requests them via <video src=...>.
  localFileUrl: (absolutePath: string) =>
    `yoink-file:///${encodeURIComponent(absolutePath)}`,
};

contextBridge.exposeInMainWorld("yoink", yoinkApi);
