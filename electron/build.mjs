/**
 * esbuild bundler for the Electron main + preload processes.
 *
 * Why esbuild and not plain tsc:
 *   - tsc emits TypeScript path aliases (`@/lib/foo`) as-is into the JS,
 *     and Node can't resolve them at runtime.
 *   - tsc-alias post-processes them, but it also incorrectly rewrites
 *     `import "electron"` to `require("../electron")` because our source
 *     folder is also named electron/ — collides with the npm package.
 *   - esbuild bundles everything into a single file, resolves aliases
 *     via tsconfig.paths, and only externalizes `electron` (the npm
 *     package) and Node built-ins. No collision, no path rewriting.
 *
 * Output:
 *   dist-electron/main.js       — Electron main process
 *   dist-electron/preload.js    — Renderer preload bridge
 */

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "dist-electron");

const watch = process.argv.includes("--watch");

/** Shared esbuild options for both bundles. */
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  // `electron` is provided by the Electron runtime - don't bundle it.
  // Node built-ins (fs, path, child_process, etc.) are auto-external on
  // platform: "node".
  external: ["electron"],
  // Resolve `@/lib/...` etc. via the tsconfig paths mapping. We use the
  // repo root's tsconfig so the alias matches what the renderer sees.
  tsconfig: path.join(__dirname, "tsconfig.json"),
  logLevel: "info",
};

const builds = [
  {
    entryPoints: [path.join(__dirname, "main.ts")],
    outfile: path.join(outDir, "main.js"),
    ...common,
  },
  {
    entryPoints: [path.join(__dirname, "preload.ts")],
    outfile: path.join(outDir, "preload.js"),
    ...common,
  },
];

if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("[electron-build] watching…");
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  console.log("[electron-build] done.");
}
