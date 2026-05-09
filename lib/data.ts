import fs from "fs/promises";
import os from "os";
import path from "path";

// Shared data directory — fixed location so the browser extension
// helper can read/write the same files without knowing where Yoink is installed.
// Windows: %APPDATA%\Yoink   |   Mac/Linux: ~/.yoink
function getDataDir(): string {
  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, "Yoink");
  }
  return path.join(os.homedir(), ".yoink");
}

export const DATA_DIR = getDataDir();

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

// One-time migration: copy files from the old local data/ folder if they
// don't already exist in the new shared location.
let migrated = false;
async function migrateFromLegacy(): Promise<void> {
  if (migrated) return;
  migrated = true;
  const legacyDir = path.join(process.cwd(), "data");
  try {
    const entries = await fs.readdir(legacyDir);
    for (const entry of entries) {
      const dst = path.join(DATA_DIR, entry);
      try {
        await fs.access(dst);
        // Already exists in new location — skip
      } catch {
        await fs.copyFile(path.join(legacyDir, entry), dst);
      }
    }
  } catch {
    // Legacy dir doesn't exist — fresh install, nothing to migrate
  }
}

export async function readJson<T>(filename: string, defaultValue: T): Promise<T> {
  await ensureDataDir();
  await migrateFromLegacy();
  try {
    const content = await fs.readFile(path.join(DATA_DIR, filename), "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return defaultValue;
  }
}

export async function writeJson(filename: string, data: unknown): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}
