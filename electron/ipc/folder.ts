/**
 * folder IPC handlers — native folder picker + open-in-explorer.
 *
 * Replaces the Next.js routes that shelled out to PowerShell and
 * `explorer.exe`. Electron's `dialog` and `shell` modules handle this
 * natively and cross-platform, so no subprocesses are needed.
 *
 * Channels:
 *   folder:pick () => string | null
 *   folder:open (path: string) => void
 */

import type { IpcMain } from "electron";
import { dialog, shell } from "electron";

export function register(ipcMain: IpcMain): void {
  ipcMain.handle("folder:pick", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select output folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("folder:open", async (_event, p: string): Promise<void> => {
    if (!p) return;
    await shell.openPath(p);
  });
}
