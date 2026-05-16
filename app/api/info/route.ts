import { NextRequest, NextResponse } from "next/server";
import { dumpJson } from "@/lib/ytdlp";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  try {
    const info = await dumpJson(url);
    return NextResponse.json({
      title: (info.title as string) ?? "",
      thumbnail: (info.thumbnail as string) ?? "",
      duration: (info.duration as number | null) ?? null,
      uploader: (info.uploader as string) ?? (info.channel as string) ?? "",
    });
  } catch {
    return NextResponse.json({ error: "Could not fetch info" }, { status: 500 });
  }
}
