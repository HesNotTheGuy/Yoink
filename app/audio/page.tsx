"use client";

/**
 * Yoink Audio Clipper — Phase 3: single-segment audio trim with waveform.
 *
 * Loads any downloaded file (audio or video — video is treated as audio-only)
 * via /api/local-file, decodes it client-side with the Web Audio API, draws
 * a waveform on a canvas, and lets the user mark in/out points before asking
 * the server to ffmpeg-encode the segment in mp3/wav/flac/aac.
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

type AudioCodec = "mp3" | "wav" | "flac" | "aac";

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

export default function AudioPage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<Float32Array | null>(null);
  const [file, setFile] = useState<string>("");
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [inPt, setInPt] = useState<number | null>(null);
  const [outPt, setOutPt] = useState<number | null>(null);
  const [codec, setCodec] = useState<AudioCodec>("mp3");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [decoding, setDecoding] = useState(false);
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

  // Decode the audio and compute peaks whenever the source file changes
  useEffect(() => {
    if (!file) {
      peaksRef.current = null;
      return;
    }

    let aborted = false;
    let audioCtx: AudioContext | null = null;
    setDecoding(true);
    setError("");
    peaksRef.current = null;
    drawWaveform();

    (async () => {
      try {
        const res = await fetch(`/api/local-file?path=${encodeURIComponent(file)}`);
        if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
        const buf = await res.arrayBuffer();
        if (aborted) return;

        const Ctx: typeof AudioContext =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new Ctx();
        const audio = await audioCtx.decodeAudioData(buf.slice(0));
        if (aborted) return;

        // Mix down to mono peak data (max abs across channels per sample,
        // then bucket-max down to a manageable count for fast redraws).
        const totalBuckets = 4096;
        const channelData: Float32Array[] = [];
        for (let c = 0; c < audio.numberOfChannels; c++) {
          channelData.push(audio.getChannelData(c));
        }
        const length = audio.length;
        const samplesPerBucket = Math.max(1, Math.floor(length / totalBuckets));
        const peaks = new Float32Array(totalBuckets);
        for (let b = 0; b < totalBuckets; b++) {
          const start = b * samplesPerBucket;
          const end = Math.min(length, start + samplesPerBucket);
          let max = 0;
          for (let i = start; i < end; i++) {
            for (let c = 0; c < channelData.length; c++) {
              const v = Math.abs(channelData[c][i]);
              if (v > max) max = v;
            }
          }
          peaks[b] = max;
        }

        if (aborted) return;
        peaksRef.current = peaks;
        drawWaveform();
      } catch (e) {
        if (!aborted) setError(`Could not decode audio: ${(e as Error).message}`);
      } finally {
        if (!aborted) setDecoding(false);
        if (audioCtx && audioCtx.state !== "closed") {
          audioCtx.close().catch(() => {});
        }
      }
    })();

    return () => {
      aborted = true;
      if (audioCtx && audioCtx.state !== "closed") {
        audioCtx.close().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Redraw whenever something visible changes
  useEffect(() => {
    drawWaveform();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, inPt, outPt, duration]);

  // Resize the canvas to match its CSS width
  useEffect(() => {
    function onResize() {
      drawWaveform();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (canvas.width !== Math.floor(cssWidth * dpr)) {
      canvas.width = Math.floor(cssWidth * dpr);
    }
    if (canvas.height !== Math.floor(cssHeight * dpr)) {
      canvas.height = Math.floor(cssHeight * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // Background
    ctx.fillStyle = "#0c1424";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const peaks = peaksRef.current;
    const mid = cssHeight / 2;

    if (peaks && peaks.length > 0) {
      ctx.fillStyle = "#818cf8";
      for (let x = 0; x < cssWidth; x++) {
        const idx = Math.floor((x / cssWidth) * peaks.length);
        const v = peaks[idx];
        const h = Math.max(1, v * (cssHeight - 4));
        ctx.fillRect(x, mid - h / 2, 1, h);
      }
    } else {
      // Subtle baseline when no peaks yet
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, mid - 0.5, cssWidth, 1);
    }

    if (duration > 0 && inPt != null && outPt != null) {
      const x1 = (inPt / duration) * cssWidth;
      const x2 = (outPt / duration) * cssWidth;
      ctx.fillStyle = "rgba(99, 102, 241, 0.3)";
      ctx.fillRect(x1, 0, x2 - x1, cssHeight);
      ctx.fillStyle = "#6366f1";
      ctx.fillRect(x1, 0, 2, cssHeight);
      ctx.fillRect(x2 - 2, 0, 2, cssHeight);
    }

    if (duration > 0) {
      const px = (current / duration) * cssWidth;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(px, 0, 1, cssHeight);
    }
  }, [current, inPt, outPt, duration]);

  // Keyboard shortcuts: I = set in, O = set out, space = play/pause
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!audioRef.current) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "i" || e.key === "I") {
        setInPt(audioRef.current.currentTime);
      } else if (e.key === "o" || e.key === "O") {
        setOutPt(audioRef.current.currentTime);
      } else if (e.key === " ") {
        e.preventDefault();
        if (audioRef.current.paused) audioRef.current.play(); else audioRef.current.pause();
      } else if (e.key === "ArrowLeft") {
        audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - (e.shiftKey ? 10 : 1));
      } else if (e.key === "ArrowRight") {
        audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + (e.shiftKey ? 10 : 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duration]);

  const onLoadedMeta = useCallback(() => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
    setInPt(0);
    setOutPt(audioRef.current.duration);
  }, []);

  const onTimeUpdate = useCallback(() => {
    if (audioRef.current) setCurrent(audioRef.current.currentTime);
  }, []);

  function pickFile(entry: HistoryEntry) {
    const localPath = `${entry.outputDir}\\${entry.title}`;
    setFile(localPath);
    setInPt(null);
    setOutPt(null);
    setOutputPath("");
    setError("");
    setProgress(0);
    setStatus("");
    setCurrent(0);
    setDuration(0);
  }

  function seek(t: number) {
    if (audioRef.current) audioRef.current.currentTime = Math.max(0, Math.min(duration, t));
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (audioRef.current.paused) audioRef.current.play();
    else audioRef.current.pause();
  }

  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    seek(x * duration);
  }

  async function exportClip() {
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
      const res = await fetch("/api/trim-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: file, inSec: inPt, outSec: outPt, codec }),
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
            setStatus("Encoding…");
          } else if (msg.type === "progress") {
            setProgress(msg.percent);
            setStatus(`Encoding… ${msg.speed ?? ""}`.trim());
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
          <h1 className="text-2xl font-bold flex-1">Audio Clipper</h1>
          <Link href="/edit" className="text-sm text-zinc-400 hover:text-white">Trim →</Link>
          <Link href="/cut" className="text-sm text-zinc-400 hover:text-white">Multi-cut →</Link>
        </div>

        {/* File picker */}
        {!file && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-widest text-zinc-400">Pick a file</h2>
            <p className="text-xs text-zinc-500">Choose one of your recent downloads, or paste an absolute path. Video files work too — audio will be extracted.</p>
            <input
              type="text"
              placeholder="C:\path\to\audio.mp3"
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
              <canvas
                ref={canvasRef}
                onClick={onCanvasClick}
                className="block w-full cursor-pointer"
                style={{ height: "120px", background: "#0c1424" }}
              />
              <audio
                ref={audioRef}
                src={`/api/local-file?path=${encodeURIComponent(file)}`}
                onLoadedMetadata={onLoadedMeta}
                onTimeUpdate={onTimeUpdate}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                className="hidden"
              />
              <div className="px-3 py-2 text-xs text-zinc-500 truncate" title={file}>{file}</div>
            </div>

            {/* Transport + selection */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <div className="flex items-center gap-2">
                  <button
                    onClick={togglePlay}
                    className="px-3 py-1 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
                  >
                    {playing ? "Pause" : "Play"}
                  </button>
                  <span>{formatTime(current)} / {formatTime(duration)}</span>
                  {decoding && <span className="text-zinc-500">Decoding waveform…</span>}
                </div>
                <span>
                  {inPt != null && outPt != null && outPt > inPt
                    ? `Selection: ${formatTime(outPt - inPt)}`
                    : ""}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
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
                  onClick={() => {
                    setFile("");
                    setOutputPath("");
                    setError("");
                    setProgress(0);
                    setStatus("");
                    setInPt(null);
                    setOutPt(null);
                    setCurrent(0);
                    setDuration(0);
                  }}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
                >
                  Pick another
                </button>
                <select
                  value={codec}
                  onChange={(e) => setCodec(e.target.value as AudioCodec)}
                  className="px-2 py-1.5 rounded-md text-xs bg-zinc-800 border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="mp3">mp3</option>
                  <option value="wav">wav</option>
                  <option value="flac">flac</option>
                  <option value="aac">aac</option>
                </select>
                <button
                  onClick={exportClip}
                  disabled={trimming || inPt == null || outPt == null || (outPt ?? 0) <= (inPt ?? 0)}
                  className="ml-auto px-4 py-1.5 rounded-md text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {trimming ? "Exporting…" : "Export"}
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
              <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">I</kbd>/<kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">O</kbd> set in/out,{" "}
              <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">←/→</kbd> seek 1s,{" "}
              <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">Shift+←/→</kbd> seek 10s.
            </div>
          </>
        )}
      </div>
    </main>
  );
}
