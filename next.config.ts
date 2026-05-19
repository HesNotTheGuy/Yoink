import type { NextConfig } from "next";

/**
 * Next.js config.
 *
 * During the v2 → v3 migration to Electron, this stays as a normal
 * Next.js app (with API routes). Electron loads the dev server at
 * localhost:3000 via `npm run dev:electron`. Once every API route is
 * ported to an Electron IPC handler, we'll switch to:
 *
 *     output: "export",
 *     images: { unoptimized: true },
 *     trailingSlash: true,
 *
 * and delete the app/api/ folder.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
