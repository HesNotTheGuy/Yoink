/**
 * Tests for the settings IPC handler.
 *
 * The handler is wired up by calling `register(mockIpcMain)`. Each test
 * captures the registered handler functions and invokes them directly
 * with synthetic IpcMainInvokeEvent objects.
 *
 * Settings storage is redirected to a temp dir per test so we don't
 * stomp on the real %APPDATA%\Yoink\settings.json.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { Settings } from "@/app/api/settings/route";

type HandlerFn = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;

function makeMockIpcMain() {
  const handlers = new Map<string, HandlerFn>();
  return {
    mock: {
      handle: (channel: string, fn: HandlerFn) => handlers.set(channel, fn),
    },
    invoke: async (channel: string, ...args: unknown[]) => {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`No handler registered for ${channel}`);
      return fn({} as Electron.IpcMainInvokeEvent, ...args);
    },
  };
}

let tmpDir: string;
let originalAppdata: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yoink-test-"));
  originalAppdata = process.env.APPDATA;
  // Point the handler's getDataDir at our temp dir
  process.env.APPDATA = tmpDir;
  fs.mkdirSync(path.join(tmpDir, "Yoink"), { recursive: true });
  // Force a fresh import of _data so it picks up the new APPDATA
  vi.resetModules();
});

afterEach(() => {
  process.env.APPDATA = originalAppdata;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("settings IPC handler", () => {
  it("returns defaults when no settings file exists", async () => {
    const { register } = await import("@/electron/ipc/settings");
    const ipc = makeMockIpcMain();
    register(ipc.mock as unknown as Electron.IpcMain);
    const s = (await ipc.invoke("settings:get")) as Settings;
    expect(s.defaultMode).toBe("video");
    expect(s.defaultQuality).toBe("best");
    expect(s.embedMetadata).toBe(true);
    expect(s.embedThumbnail).toBe(true);
    expect(s.cookiesFile).toBe("");
    // outputDir is platform-dependent (Downloads folder) — just verify it's a non-empty string
    expect(typeof s.outputDir).toBe("string");
    expect(s.outputDir.length).toBeGreaterThan(0);
  });

  it("writes to disk via settings:save and reads it back via settings:get", async () => {
    const { register } = await import("@/electron/ipc/settings");
    const ipc = makeMockIpcMain();
    register(ipc.mock as unknown as Electron.IpcMain);
    const updates: Partial<Settings> = {
      outputDir: "C:\\custom\\out",
      defaultMode: "audio",
      defaultQuality: "1080p",
      embedMetadata: false,
      embedThumbnail: false,
      cookiesFile: "C:\\cookies.txt",
    };
    await ipc.invoke("settings:save", updates);
    // file must exist on disk
    const onDisk = path.join(tmpDir, "Yoink", "settings.json");
    expect(fs.existsSync(onDisk)).toBe(true);
    // and reading back should return what we wrote
    const s = (await ipc.invoke("settings:get")) as Settings;
    expect(s.outputDir).toBe("C:\\custom\\out");
    expect(s.defaultMode).toBe("audio");
    expect(s.defaultQuality).toBe("1080p");
    expect(s.embedMetadata).toBe(false);
    expect(s.embedThumbnail).toBe(false);
    expect(s.cookiesFile).toBe("C:\\cookies.txt");
  });

  it("merges partial updates with defaults instead of clobbering unrelated fields", async () => {
    const { register } = await import("@/electron/ipc/settings");
    const ipc = makeMockIpcMain();
    register(ipc.mock as unknown as Electron.IpcMain);
    // Save only outputDir
    await ipc.invoke("settings:save", { outputDir: "C:\\foo" });
    const s = (await ipc.invoke("settings:get")) as Settings;
    expect(s.outputDir).toBe("C:\\foo");
    // Unrelated fields still hold their defaults
    expect(s.defaultMode).toBe("video");
    expect(s.defaultQuality).toBe("best");
    expect(s.embedMetadata).toBe(true);
    expect(s.embedThumbnail).toBe(true);
    expect(s.cookiesFile).toBe("");
  });
});
