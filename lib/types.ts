/**
 * types.ts — shared types used across the renderer (lib/api-client.ts),
 * the Electron IPC handlers (electron/ipc/*.ts), and the tests.
 *
 * These were previously co-located with the legacy Next.js API routes
 * (`app/api/settings/route.ts`, `app/api/formats/route.ts`). After the
 * v2 -> v3 migration the routes are gone, so the type definitions live
 * here in a shared module instead.
 */

export interface Settings {
  outputDir: string;
  defaultMode: "video" | "audio";
  defaultQuality: string;
  embedMetadata: boolean;
  embedThumbnail: boolean;
  cookiesFile: string;
  /**
   * Optional download rate limit passed to yt-dlp's --limit-rate (e.g.
   * "1M", "500K"). Empty string means unlimited. Lives here in the shared
   * type so the renderer and the settings IPC handler can't drift - a
   * missing field here silently dropped the value on save before.
   */
  speedLimit: string;
}

export interface Format {
  format_id: string;
  ext: string;
  resolution: string;
  fps: number | null;
  vcodec: string;
  acodec: string;
  filesize: number | null;
  format_note: string;
}
