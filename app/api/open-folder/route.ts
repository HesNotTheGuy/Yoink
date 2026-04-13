import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";

export async function POST(req: NextRequest) {
  const { path } = await req.json();
  if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });
  spawn("explorer.exe", [path], { detached: true, stdio: "ignore" }).unref();
  return NextResponse.json({ ok: true });
}
