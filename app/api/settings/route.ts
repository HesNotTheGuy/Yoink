import { NextRequest, NextResponse } from "next/server";
import { readJson, writeJson } from "@/lib/data";

export interface Settings {
  outputDir: string;
  defaultMode: "video" | "audio";
  defaultQuality: string;
  embedMetadata: boolean;
  embedThumbnail: boolean;
  cookiesFile: string;
}

const homeDir = process.env.USERPROFILE ?? process.env.HOME ?? "C:\\Users\\Public";

export const DEFAULT_SETTINGS: Settings = {
  outputDir: `${homeDir}\\Downloads`,
  defaultMode: "video",
  defaultQuality: "best",
  embedMetadata: true,
  embedThumbnail: true,
  cookiesFile: "",
};

export async function GET() {
  const settings = await readJson<Settings>("settings.json", DEFAULT_SETTINGS);
  return NextResponse.json({ ...DEFAULT_SETTINGS, ...settings });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  await writeJson("settings.json", { ...DEFAULT_SETTINGS, ...body });
  return NextResponse.json({ ok: true });
}
