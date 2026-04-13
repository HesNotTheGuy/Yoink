import { NextRequest, NextResponse } from "next/server";
import { downloads } from "@/lib/store";

export async function POST(req: NextRequest) {
  const { id } = await req.json();
  const dl = downloads.get(id);
  if (!dl) return NextResponse.json({ error: "Not found" }, { status: 404 });

  dl.proc?.kill();
  dl.status = "error";
  dl.error = "Cancelled";
  dl.subscribers.forEach((cb) =>
    cb(JSON.stringify({ type: "error", message: "Cancelled" }))
  );
  dl.subscribers.clear();

  return NextResponse.json({ ok: true });
}
