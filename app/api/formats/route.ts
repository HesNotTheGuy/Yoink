import { NextRequest, NextResponse } from "next/server";
import { dumpJson } from "@/lib/ytdlp";

export interface Format {
  format_id: string;
  ext: string;
  resolution: string;
  fps: number | null;
  vcodec: string;
  acodec: string;
  filesize: number | null;
  format_note: string;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  try {
    const info = await dumpJson(url);
    const rawFormats = (info.formats as Format[] | undefined) ?? [];
    const formats: Format[] = rawFormats.map((f) => ({
      format_id: f.format_id,
      ext: f.ext,
      resolution: f.resolution ?? "audio only",
      fps: f.fps ?? null,
      vcodec: f.vcodec ?? "none",
      acodec: f.acodec ?? "none",
      filesize: f.filesize ?? null,
      format_note: f.format_note ?? "",
    }));
    return NextResponse.json({ formats });
  } catch {
    return NextResponse.json({ error: "Could not fetch formats" }, { status: 500 });
  }
}
