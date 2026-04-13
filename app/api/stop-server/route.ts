import { NextResponse } from "next/server";

export async function POST() {
  // Respond before killing so the client gets the response
  setTimeout(() => process.exit(0), 300);
  return NextResponse.json({ ok: true });
}
