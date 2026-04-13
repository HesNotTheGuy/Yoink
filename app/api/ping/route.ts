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
  return NextResponse.json({ ok: true });
}
