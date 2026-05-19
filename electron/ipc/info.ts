/**
 * info IPC handler — fetch lightweight video metadata for a URL.
 *
 * Shells out via lib/ytdlp.ts's dumpJson (yt-dlp --dump-json) and
 * extracts the four fields the renderer cares about. Mirrors the
 * shape of the legacy Next.js /api/info route so the fetch fallback
 * in lib/api-client.ts and this IPC return identical objects.
 *
 * Channel:
 *   info:get (url: string) => VideoInfo
 */

import type { IpcMain } from "electron";
import { dumpJson } from "@/lib/ytdlp";
import type { VideoInfo } from "@/lib/api-client";

export function register(ipcMain: IpcMain): void {
  ipcMain.handle("info:get", async (_event, url: string): Promise<VideoInfo> => {
    try {
      const info = await dumpJson(url);
      return {
        title: (info.title as string) ?? "",
        thumbnail: (info.thumbnail as string) ?? "",
        duration: (info.duration as number | null) ?? null,
        uploader: (info.uploader as string) ?? (info.channel as string) ?? "",
      };
    } catch (err) {
      throw new Error(`Could not fetch info: ${(err as Error).message}`);
    }
  });
}
