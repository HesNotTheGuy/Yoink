"use client";

/**
 * Yoink Editor — Phase 1: single-segment trim.
 *
 * Opens a downloaded file by ?file=<absolute path>, lets the user mark
 * an in/out point, then asks the server to ffmpeg-trim the segment.
 * Falls into Phase 2 (multi-cut) later — those edits live in a separate
 * page so this file stays focused on the trim case.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";

interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  mode: string;
  outputDir: string;
  status: "done" | "error";
  completedAt: number;
}

function formatTime(sec: number): string {
  if (!isFinite(sec)) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 100);
  const base = h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
  return `${base}.${String(ms).padStart(2, "0")}`;
}

export default function EditPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [file, setFile] = useState<string>("");
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [inPt, setInPt] = useState<number | null>(null);
  const [outPt, setOutPt] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [trimming, setTrimming] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [outputPath, setOutputPath] = useState<string>("");

  // Read ?file= from URL on first render
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const f = params.get("file");
    if (f) setFile(f);
  }, []);

  // Load history for the file picker
  useEffect(() => {
    fetch("/api/history")
      .then((r) => r.json())
      .then((data: HistoryEntry[]) => setHistory(data.filter((h) => h.status === "done")))
      .catch(() => setHistory([]));
  }, []);

  // Keyboard shortcuts: I = set in, O = set out, space = play/pause
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!videoRef.current) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "i" || e.key === "I") {
        setInPt(videoRef.current.currentTime);
      } else if (e.key === "o" || e.key === "O") {
        setOutPt(videoRef.current.currentTime);
      } else if (e.key === " ") {
        e.preventDefault();
        if (videoRef.current.paused) videoRef.current.play(); else videoRef.current.pause();
      } else if (e.key === "ArrowLeft") {
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - (e.shiftKey ? 10 : 1));
      } else if (e.key === "ArrowRight") {
        videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + (e.shiftKey ? 10 : 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duration]);

  const onLoadedMeta = useCallback(() => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration);
    setInPt(0);
    setOutPt(videoRef.current.duration);
  }, []);

  const onTimeUpdate = useCallback(() => {
    if (videoRef.current) setCurrent(videoRef.current.currentTime);
  }, []);

  function pickFile(entry: HistoryEntry) {
    const localPath = `${entry.outputDir}\\${entry.title}`;
    setFile(localPath);
    setInPt(null);
    setOutPt(null);
    setOutputPath("");
    setError("");
  }

  function seek(t: number) {
    if (videoRef.current) videoRef.current.currentTime = Math.max(0, Math.min(duration, t));
  }

  async function trim() {
    if (!file || inPt == null || outPt == null || outPt <= inPt) {
      setError("Set both in and out points first.");
      return;
    }
    setTrimming(true);
    setProgress(0);
    setStatus("Starting…");
    setError("");
    setOutputPath("");

    try {
      const res = await fetch("/api/trim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: file, inSec: inPt, outSec: outPt }),
      });
      if (!res.ok || !res.body) throw new Error("Server error");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          const line = ev.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const msg = JSON.parse(line.slice(6));
          if (msg.type === "start") {
            setStatus("Trimming…");
          } else if (msg.type === "progress") {
            setProgress(msg.percent);
            setStatus(`Trimming… ${msg.speed ?? ""}`.trim());
          } else if (msg.type === "done") {
            setProgress(100);
            setStatus("Done");
            setOutputPath(msg.output);
          } else if (msg.type === "error") {
            setError(msg.message);
            setStatus("");
          }
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrimming(false);
    }
  }

  function openFolder(p: string) {
    const dir = p.replace(/[/\\][^/\\]+$/, "");
    fetch("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: dir }),
    }).catch(() => {});
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-3xl mx-auto space-y-4">

        <div className="flex items-center gap-3">
          <Link href="/" className="text-zinc-400 hover:text-white text-sm">← Yoink</Link>
          <h1 className="text-2xl font-bold flex-1">Trim</h1>
          <Link href="/cut" className="text-sm text-zinc-400 hover:text-white">Multi-cut →</Link>
          <Link href="/audio" className="text-sm text-zinc-400 hover:text-white">Audio clipper →</Link>
        </div>

        {/* File picker */}
        {!file && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-widest text-zinc-400">Pick a file</h2>
            <p className="text-xs text-zinc-500">Choose one of your recent downloads, or paste an absolute path.</p>
            <input
              type="text"
              placeholder="C:\path\to\video.mp4"
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => {
                if (e.key === "Enter") setFile((e.target as HTMLInputElement).value);
              }}
            />
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {history.length === 0 && <div className="text-xs text-zinc-500">No completed downloads in history.</div>}
              {history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => pickFile(h)}
                  className="w-full text-left flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 px-3 py-2"
                >
                  <span className="flex-1 text-sm truncate">{h.title}</span>
                  <span className="text-xs text-zinc-500 shrink-0">{h.mode}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Editor */}
        {file && (
          <>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
              <video
                ref={videoRef}
                src={`/api/local-file?path=${encodeURIComponent(file)}`}
                controls
                onLoadedMetadata={onLoadedMeta}
                onTimeUpdate={onTimeUpdate}
                className="w-full bg-black aspect-video"
              />
              <div className="px-3 py-2 text-xs text-zinc-500 truncate" title={file}>{file}</div>
            </div>

            {/* Timeline */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>{formatTime(current)}</span>
                <span>{formatTime(duration)}</span>
              </div>

              <div className="relative h-8 bg-zinc-800 rounded">
                {/* Selected range overlay */}
                {inPt != null && outPt != null && duration > 0 && (
                  <div
                    className="absolute top-0 bottom-0 bg-blue-500/30 border-l-2 border-r-2 border-blue-500"
                    style={{
                      left:  `${(inPt  / duration) * 100}%`,
                      width: `${((outPt - inPt) / duration) * 100}%`,
                    }}
                  />
                )}
                {/* Playhead */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-white"
                  style={{ left: `${duration > 0 ? (current / duration) * 100 : 0}%` }}
                />
                {/* Click-to-seek */}
                <div
                  className="absolute inset-0 cursor-pointer"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = (e.clientX - rect.left) / rect.width;
                    seek(x * duration);
                  }}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setInPt(current)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
                  title="Keyboard: I"
                >
                  Set in [I] {inPt != null && <span className="text-zinc-400">{formatTime(inPt)}</span>}
                </button>
                <button
                  onClick={() => setOutPt(current)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
                  title="Keyboard: O"
                >
                  Set out [O] {outPt != null && <span className="text-zinc-400">{formatTime(outPt)}</span>}
                </button>
                <button
                  onClick={() => { setInPt(0); setOutPt(duration); }}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
                >
                  Reset
                </button>
                <button
                  onClick={() => { setFile(""); setOutputPath(""); setError(""); }}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
                >
                  Pick another
                </button>
                <button
                  onClick={trim}
                  disabled={trimming || inPt == null || outPt == null || (outPt ?? 0) <= (inPt ?? 0)}
                  className="ml-auto px-4 py-1.5 rounded-md text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {trimming ? "Trimming…" : "Trim"}
                </button>
              </div>

              {/* Progress */}
              {(trimming || progress > 0) && (
                <div className="space-y-1">
                  <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="text-xs text-zinc-400">{status}</div>
                </div>
              )}

              {/* Output result */}
              {outputPath && (
                <div className="text-xs flex items-center gap-2 text-green-400">
                  Saved to <span className="font-mono truncate flex-1" title={outputPath}>{outputPath}</span>
                  <button onClick={() => openFolder(outputPath)} className="underline">Open folder</button>
                </div>
              )}

              {error && <div className="text-xs text-red-400">Error: {error}</div>}
            </div>

            <div className="text-xs text-zinc-500">
              Tips: <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">Space</kbd> play/pause,{" "}
              <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">←/→</kbd> seek 1s,{" "}
              <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">Shift+←/→</kbd> seek 10s.
            </div>
          </>
        )}
      </div>
    </main>
  );
}
