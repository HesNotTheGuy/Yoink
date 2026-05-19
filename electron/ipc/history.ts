/**
 * history IPC handler — read/write the shared download history.
 *
 * Reads/writes %APPDATA%\Yoink\history.json (same location as the
 * Next.js server, the extension helper, and the Premiere plugin).
 *
 * Channels:
 *   history:get   () => HistoryEntry[]
 *   history:add   (entry: HistoryEntry) => void
 *   history:clear () => void
 */

import type { IpcMain } from "electron";
import { readHistory, writeHistory } from "./_data";
import type { HistoryEntry } from "@/lib/api-client";

export function register(ipcMain: IpcMain): void {
  ipcMain.handle("history:get", async (): Promise<HistoryEntry[]> => {
    return readHistory();
  });

  ipcMain.handle("history:add", async (_event, entry: HistoryEntry): Promise<void> => {
    const list = readHistory();
    list.unshift(entry);
    if (list.length > 100) list.length = 100;
    writeHistory(list);
  });

  ipcMain.handle("history:clear", async (): Promise<void> => {
    writeHistory([]);
  });
}
