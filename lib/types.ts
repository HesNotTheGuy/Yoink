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
