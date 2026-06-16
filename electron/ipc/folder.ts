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
import fs from "fs";
import path from "path";

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
    // Only ever open a DIRECTORY in the system file manager. A compromised
    // renderer must not be able to hand us an executable path and have
    // shell.openPath launch it. If the target is a file (or doesn't exist),
    // open its containing directory instead.
    let target = p;
    try {
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        target = path.dirname(target);
      }
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        return; // give up rather than open something unexpected
      }
    } catch {
      return;
    }
    await shell.openPath(target);
  });
}
