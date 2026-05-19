import { NextResponse } from "next/server";

const g = globalThis as typeof globalThis & { __shutdownTimer?: ReturnType<typeof setTimeout> };

function resetTimer() {
  if (g.__shutdownTimer) clearTimeout(g.__shutdownTimer);
  g.__shutdownTimer = setTimeout(() => process.exit(0), 10_000);
}

// Start the timer on first import (server startup)
resetTimer();

export async function POST() {
  resetTimer();
  return NextResponse.json({ ok: true, app: "yoink" });
}

// GET is used by launch.cmd to detect "is Yoink already running on this port?"
// The response includes the literal string "yoink" so launch.cmd can verify
// it isn't talking to some unrelated dev server (Vite, Next.js for another
// project, etc.) that happens to be on the same port.
export async function GET() {
  resetTimer();
  return NextResponse.json({ ok: true, app: "yoink" });
}
