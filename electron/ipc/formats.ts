/**
 * formats IPC handler — TODO: implement.
 * Stub registers nothing so main.ts compiles; renderer falls back to
 * the Next.js /api route via lib/api-client.ts until this is filled in.
 */
import type { IpcMain } from "electron";

export function register(_ipcMain: IpcMain): void {
  // Empty - renderer falls through to the Next.js fetch fallback.
}
