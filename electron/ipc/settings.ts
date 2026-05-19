/**
 * settings IPC handler — read/write the shared user settings.
 *
 * Reads/writes %APPDATA%\Yoink\settings.json (same location as the
 * Next.js server and the browser extension helper). Defaults are
 * merged in by readSettings()/writeSettings() in _data.ts, so a
 * partial save never clobbers unrelated fields.
 *
 * Channels:
 *   settings:get  () => Settings
 *   settings:save (s: Partial<Settings>) => void
 */

import type { IpcMain } from "electron";
import { readSettings, writeSettings } from "./_data";
import type { Settings } from "@/lib/types";

export function register(ipcMain: IpcMain): void {
  ipcMain.handle("settings:get", async (): Promise<Settings> => {
    return readSettings();
  });

  ipcMain.handle("settings:save", async (_event, s: Partial<Settings>): Promise<void> => {
    writeSettings(s);
  });
}
