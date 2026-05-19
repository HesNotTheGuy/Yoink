/**
 * Tests for the history IPC handler.
 *
 * The handler is wired up by calling `register(mockIpcMain)`. Each test
 * captures the registered handler functions and invokes them directly
 * with synthetic IpcMainInvokeEvent objects.
 *
 * History storage is redirected to a temp dir per test so we don't
 * stomp on the real %APPDATA%\Yoink\history.json.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

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

describe("history IPC handler", () => {
  it("returns an empty array when no history file exists", async () => {
    const { register } = await import("@/electron/ipc/history");
    const ipc = makeMockIpcMain();
    register(ipc.mock as unknown as Electron.IpcMain);
    const list = await ipc.invoke("history:get");
    expect(list).toEqual([]);
  });

  it("returns entries previously written", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "Yoink", "history.json"),
      JSON.stringify([
        { id: "1", url: "u", title: "t", thumbnail: "", mode: "video", outputDir: "d", status: "done", completedAt: 1 },
      ])
    );
    const { register } = await import("@/electron/ipc/history");
    const ipc = makeMockIpcMain();
    register(ipc.mock as unknown as Electron.IpcMain);
    const list = (await ipc.invoke("history:get")) as unknown[];
    expect(list).toHaveLength(1);
  });

  it("prepends new entries via history:add", async () => {
    const { register } = await import("@/electron/ipc/history");
    const ipc = makeMockIpcMain();
    register(ipc.mock as unknown as Electron.IpcMain);
    await ipc.invoke("history:add", { id: "1", url: "u1", title: "first", thumbnail: "", mode: "video", outputDir: "d", status: "done", completedAt: 1 });
    await ipc.invoke("history:add", { id: "2", url: "u2", title: "second", thumbnail: "", mode: "video", outputDir: "d", status: "done", completedAt: 2 });
    const list = (await ipc.invoke("history:get")) as { title: string }[];
    expect(list[0].title).toBe("second");
    expect(list[1].title).toBe("first");
  });

  it("caps history at 100 entries", async () => {
    const { register } = await import("@/electron/ipc/history");
    const ipc = makeMockIpcMain();
    register(ipc.mock as unknown as Electron.IpcMain);
    for (let i = 0; i < 105; i++) {
      await ipc.invoke("history:add", {
        id: String(i),
        url: `u${i}`,
        title: `entry-${i}`,
        thumbnail: "",
        mode: "video",
        outputDir: "d",
        status: "done",
        completedAt: i,
      });
    }
    const list = (await ipc.invoke("history:get")) as unknown[];
    expect(list).toHaveLength(100);
  });

  it("clears all entries via history:clear", async () => {
    const { register } = await import("@/electron/ipc/history");
    const ipc = makeMockIpcMain();
    register(ipc.mock as unknown as Electron.IpcMain);
    await ipc.invoke("history:add", { id: "1", url: "u", title: "t", thumbnail: "", mode: "video", outputDir: "d", status: "done", completedAt: 1 });
    await ipc.invoke("history:clear");
    const list = await ipc.invoke("history:get");
    expect(list).toEqual([]);
  });
});
