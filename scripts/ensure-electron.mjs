/**
 * Electron 42 and newer do not download the runtime from an npm postinstall
 * script. electron-builder and `electron .` need the binary on disk, so this
 * runs the package's installer when `path.txt` does not point at one yet.
 */

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const electronPkg = path.dirname(require.resolve("electron/package.json"));
const pathFile = path.join(electronPkg, "path.txt");

if (fs.existsSync(pathFile)) {
  const binaryName = fs.readFileSync(pathFile, "utf8").trim();
  const binary = path.join(electronPkg, "dist", binaryName);
  if (binaryName && fs.existsSync(binary)) {
    process.exit(0);
  }
}

const installer = path.join(electronPkg, "install.js");
if (!fs.existsSync(installer)) {
  console.error(
    "[ensure-electron] electron/install.js is missing. Refusing to continue without the Electron binary."
  );
  process.exit(1);
}

console.log("[ensure-electron] downloading the Electron binary");
const result = spawnSync(process.execPath, [installer], { stdio: "inherit" });
if (result.status !== 0) {
  console.error("[ensure-electron] Electron binary download failed.");
  process.exit(result.status ?? 1);
}
