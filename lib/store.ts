import type { ChildProcess } from "child_process";

export type DownloadStatus = "pending" | "downloading" | "done" | "error";

export interface Download {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  status: DownloadStatus;
  progress: number;
  speed: string;
  eta: string;
  error: string;
  outputDir: string;
  mode: "video" | "audio";
  quality: string;
  createdAt: number;
  proc?: ChildProcess;
  subscribers: Set<(line: string) => void>;
}

// Global in-memory store (works for single local server instance)
const globalStore = globalThis as typeof globalThis & {
  __ytdlp_downloads?: Map<string, Download>;
};

if (!globalStore.__ytdlp_downloads) {
  globalStore.__ytdlp_downloads = new Map();
}

export const downloads = globalStore.__ytdlp_downloads;
