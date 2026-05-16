"use client";

/**
 * Yoink Editor — Phase 2: multi-segment cut.
 *
 * Lets the user define multiple kept ranges and concatenates them into a
 * single output file via ffmpeg. Mirrors the layout/styling of /edit so the
 * two editor surfaces feel like siblings.
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

interface Segment {
  id: string;
  start: number;
  end: number;
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

function newSegmentId(): string {
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function CutPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [file, setFile] = useState<string>("");
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [rendering, setRendering] = useState(false);
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

  // Keyboard shortcuts:
  //   Space  - play/pause
  //   I / O  - set start/end of the last (currently-selected) segment to playhead
  //   ←/→    - seek 1s (Shift = 10s)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!videoRef.current) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const t = videoRef.current.currentTime;
      if (e.key === "i" || e.key === "I") {
        setSegments((prev) => {
          if (prev.length === 0) return prev;
          const next = prev.slice();
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, start: t };
          return next;
        });
      } else if (e.key === "o" || e.key === "O") {
        setSegments((prev) => {
          if (prev.length === 0) return prev;
          const next = prev.slice();
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, end: t };
          return next;
        });
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
  }, []);

  const onTimeUpdate = useCallback(() => {
    if (videoRef.current) setCurrent(videoRef.current.currentTime);
  }, []);

  function pickFile(entry: HistoryEntry) {
    const localPath = `${entry.outputDir}\\${entry.title}`;
    setFile(localPath);
    setSegments([]);
    setOutputPath("");
    setError("");
  }

  function seek(t: number) {
    if (videoRef.current) videoRef.current.currentTime = Math.max(0, Math.min(duration, t));
  }

  function addSegment() {
    const start = current;
    const end = Math.min(duration, current + 5);
    setSegments((prev) => [...prev, { id: newSegmentId(), start, end }]);
  }

  function removeSegment(id: string) {
    setSegments((prev) => prev.filter((s) => s.id !== id));
  }

  function setSegmentStart(id: string, t: number) {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, start: t } : s)));
  }

  function setSegmentEnd(id: string, t: number) {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, end: t } : s)));
  }

  const totalKept = segments.reduce((acc, s) => acc + Math.max(0, s.end - s.start), 0);
  const canRender =
    !rendering &&
    file.length > 0 &&
    segments.length > 0 &&
    segments.every((s) => s.end > s.start);

  async function render() {
    if (!canRender) {
      setError("Add at least one valid segment first.");
      return;
    }
    setRendering(true);
    setProgress(0);
    setStatus("Starting…");
    setError("");
    setOutputPath("");

    // Send segments in source-timeline order.
    const ordered = segments
      .slice()
      .sort((a, b) => a.start - b.start)
      .map((s) => ({ start: s.start, end: s.end }));

    try {
      const res = await fetch("/api/cut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: file, segments: ordered }),
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
            setStatus("Preparing segments…");
          } else if (msg.type === "segment") {
            setStatus(`Trimming segment ${msg.index + 1}/${msg.total}…`);
          } else if (msg.type === "progress") {
            setProgress(msg.percent);
            setStatus("Joining segments…");
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
      setRendering(false);
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
          <h1 className="text-2xl font-bold flex-1">Multi-cut</h1>
          <Link href="/edit" className="text-sm text-zinc-400 hover:text-white">Trim →</Link>
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
                <span>Kept: {formatTime(totalKept)} / {formatTime(duration)}</span>
              </div>

              <div className="relative h-8 bg-zinc-800 rounded">
                {/* Segment overlays */}
                {duration > 0 && segments.map((s) => {
                  const left = (Math.max(0, s.start) / duration) * 100;
                  const width = (Math.max(0, s.end - s.start) / duration) * 100;
                  return (
                    <div
                      key={s.id}
                      className="absolute top-0 bottom-0 bg-blue-500/30 border-l-2 border-r-2 border-blue-500"
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  );
                })}
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
                  onClick={addSegment}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
                >
                  + Add segment
                </button>
                <button
                  onClick={() => setSegments([])}
                  disabled={segments.length === 0}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear all
                </button>
                <button
                  onClick={() => { setFile(""); setOutputPath(""); setError(""); setSegments([]); }}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
                >
                  Pick another
                </button>
                <button
                  onClick={render}
                  disabled={!canRender}
                  className="ml-auto px-4 py-1.5 rounded-md text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {rendering ? "Rendering…" : "Render cut"}
                </button>
              </div>

              {/* Segment list */}
              {segments.length > 0 && (
                <div className="space-y-1.5">
                  {segments.map((s, i) => {
                    const invalid = s.end <= s.start;
                    return (
                      <div
                        key={s.id}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                          invalid
                            ? "border-red-700 bg-red-950/40"
                            : "border-zinc-800 bg-zinc-950"
                        }`}
                      >
                        <span className="font-mono text-zinc-500 w-6">#{i + 1}</span>
                        <span className="text-zinc-300 font-mono">{formatTime(s.start)}</span>
                        <span className="text-zinc-600">→</span>
                        <span className="text-zinc-300 font-mono">{formatTime(s.end)}</span>
                        <span className="text-zinc-500">({formatTime(Math.max(0, s.end - s.start))})</span>
                        <div className="ml-auto flex gap-1.5">
                          <button
                            onClick={() => setSegmentStart(s.id, current)}
                            className="px-2 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
                            title="Set start to playhead"
                          >
                            Set start
                          </button>
                          <button
                            onClick={() => setSegmentEnd(s.id, current)}
                            className="px-2 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
                            title="Set end to playhead"
                          >
                            Set end
                          </button>
                          <button
                            onClick={() => seek(s.start)}
                            className="px-2 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
                            title="Seek to start"
                          >
                            Go
                          </button>
                          <button
                            onClick={() => removeSegment(s.id)}
                            className="px-2 py-1 rounded text-[11px] bg-zinc-800 hover:bg-red-900 border border-zinc-700 text-red-400"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Progress */}
              {(rendering || progress > 0) && (
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
              <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">I/O</kbd> set start/end of last segment,{" "}
              <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">←/→</kbd> seek 1s,{" "}
              <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">Shift+←/→</kbd> seek 10s.
            </div>
          </>
        )}
      </div>
    </main>
  );
}
