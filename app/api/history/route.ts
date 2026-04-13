import { NextRequest, NextResponse } from "next/server";
import { readJson, writeJson } from "@/lib/data";

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  mode: string;
  outputDir: string;
  status: "done" | "error";
  completedAt: number;
  error?: string;
}

export async function GET() {
  const history = await readJson<HistoryEntry[]>("history.json", []);
  return NextResponse.json(history);
}

export async function POST(req: NextRequest) {
  const entry: HistoryEntry = await req.json();
  const history = await readJson<HistoryEntry[]>("history.json", []);
  const updated = [entry, ...history].slice(0, 100);
  await writeJson("history.json", updated);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await writeJson("history.json", []);
  return NextResponse.json({ ok: true });
}
