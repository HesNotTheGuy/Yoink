/**
 * formats IPC handler — list the available yt-dlp formats for a URL.
 *
 * Shells out via lib/ytdlp.ts's dumpJson and normalizes the raw
 * formats array the same way the legacy Next.js /api/formats route
 * does, so the renderer sees identical objects whether it goes
 * through IPC or the fetch fallback in lib/api-client.ts.
 *
 * Channel:
 *   formats:get (url: string) => Format[]
 */

import type { IpcMain } from "electron";
import { dumpJson } from "@/lib/ytdlp";
import type { Format } from "@/app/api/formats/route";

export function register(ipcMain: IpcMain): void {
  ipcMain.handle("formats:get", async (_event, url: string): Promise<Format[]> => {
    try {
      const info = await dumpJson(url);
      const rawFormats = (info.formats as Format[] | undefined) ?? [];
      return rawFormats.map((f) => ({
        format_id: f.format_id,
        ext: f.ext,
        resolution: f.resolution ?? "audio only",
        fps: f.fps ?? null,
        vcodec: f.vcodec ?? "none",
        acodec: f.acodec ?? "none",
        filesize: f.filesize ?? null,
        format_note: f.format_note ?? "",
      }));
    } catch (err) {
      throw new Error(`Could not fetch formats: ${(err as Error).message}`);
    }
  });
}
