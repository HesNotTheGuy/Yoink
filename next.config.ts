import type { NextConfig } from "next";

/**
 * Next.js produces a static export (out/ folder) that Electron loads via
 * file:// in production. No server runtime, no API routes.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
