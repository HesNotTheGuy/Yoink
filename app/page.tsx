"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { THEMES, THEME_CSS, THEME_KEYS, type Theme } from "@/lib/themes";

const GUI_VERSION = "2.1.1";

type Mode = "video" | "audio";
type DownloadStatus = "idle" | "pending" | "downloading" | "done" | "error";

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

interface ActiveDownload {
  id: string;
  url: string;
  mode: Mode;
  title: string;
  thumbnail: string;
  status: DownloadStatus;
  progress: number;
  speed: string;
  eta: string;
  error: string;
  logs: string[];
  outputDir: string;
}

interface HistoryEntry {
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

interface Settings {
  outputDir: string;
  defaultMode: "video" | "audio";
  defaultQuality: string;
  embedMetadata: boolean;
  embedThumbnail: boolean;
  cookiesFile: string;
  speedLimit: string;
}

const DEFAULT_SETTINGS: Settings = {
  outputDir: "",
  defaultMode: "video",
  defaultQuality: "best",
  embedMetadata: true,
  embedThumbnail: true,
  cookiesFile: "",
  speedLimit: "",
};

const VIDEO_QUALITIES = ["best", "1080p", "720p", "480p", "360p"];


function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function Home() {
  // URL & form state
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<Mode>("video");
  const [quality, setQuality] = useState("best");
  const [outputDir, setOutputDir] = useState(DEFAULT_SETTINGS.outputDir);
  const [embedMetadata, setEmbedMetadata] = useState(true);
  const [embedThumbnail, setEmbedThumbnail] = useState(true);
  const [cookiesFile, setCookiesFile] = useState("");
  const [selectedFormat, setSelectedFormat] = useState("bestvideo+bestaudio/best");
  const [speedLimit, setSpeedLimit] = useState("");

  // Batch mode
  const [batchMode, setBatchMode] = useState(false);
  const [batchUrls, setBatchUrls] = useState("");

  // Video info
  const [videoInfo, setVideoInfo] = useState<{ title: string; thumbnail: string; duration: number | null; uploader: string } | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState(false);
  const [formats, setFormats] = useState<{ format_id: string; ext: string; resolution: string; fps: number | null; filesize: number | null; vcodec: string; acodec: string }[]>([]);

  // Downloads
  const [downloads, setDownloads] = useState<ActiveDownload[]>([]);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const eventSources = useRef<Map<string, EventSource>>(new Map());

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Theme (client-only, localStorage)
  const [theme, setTheme] = useState<Theme>("slate");

  // Update
  const [updating, setUpdating] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateState, setUpdateState] = useState<{
    fromVersion: string;
    toVersion: string;
    status: "idle" | "checking" | "downloading" | "done" | "error" | "up-to-date";
    error: string;
  }>({ fromVersion: "", toVersion: "", status: "idle", error: "" });
  const [ytdlpVersion, setYtdlpVersion] = useState("");
  const [buildVariant, setBuildVariant] = useState("");

  // Panels
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Settings draft (in-drawer)
  const [draftSettings, setDraftSettings] = useState<Settings>(DEFAULT_SETTINGS);

  // History
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const infoDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load theme from localStorage on mount ───────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem("theme") as Theme | null;
    if (saved && THEME_KEYS.includes(saved)) {
      setTheme(saved);
    }
  }, []);

  // ── Inject theme CSS variables ───────────────────────────────────────────
  useEffect(() => {
    let el = document.getElementById("theme-override") as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = "theme-override";
      document.head.appendChild(el);
    }
    el.textContent = THEME_CSS[theme];
  }, [theme]);

  // ── Load settings on mount ──────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: Settings) => {
        setOutputDir(s.outputDir);
        setMode(s.defaultMode);
        setQuality(s.defaultQuality);
        setEmbedMetadata(s.embedMetadata);
        setEmbedThumbnail(s.embedThumbnail);
        setCookiesFile(s.cookiesFile);
        setSpeedLimit(s.speedLimit ?? "");
        setDraftSettings({ ...DEFAULT_SETTINGS, ...s });
      })
      .catch(() => {});
  }, []);

  // ── Load history on mount ───────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/history")
      .then((r) => r.json())
      .then((data: HistoryEntry[]) => setHistory(data))
      .catch(() => {});
  }, []);

  // ── Heartbeat ───────────────────────────────────────────────────────────
  useEffect(() => {
    const ping = () => fetch("/api/ping", { method: "POST" }).catch(() => {});
    ping();
    const id = setInterval(ping, 5_000);
    return () => clearInterval(id);
  }, []);

  // ── Load build variant ──────────────────────────────────────────────────
  useEffect(() => {
    fetch("/build-info.json")
      .then((r) => r.json())
      .then(({ variant }) => { if (variant) setBuildVariant(variant); })
      .catch(() => {});
  }, []);

  // ── Check for yt-dlp updates on startup ────────────────────────────────
  useEffect(() => {
    fetch("/api/check-update")
      .then((r) => r.json())
      .then(({ updateAvailable: ua, current }) => {
        setUpdateAvailable(ua);
        if (current) setYtdlpVersion(current);
      })
      .catch(() => {});
  }, []);

  // ── Request notification permission ────────────────────────────────────
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // ── Global paste listener (paste & go) ─────────────────────────────────
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
      if (text.startsWith("http://") || text.startsWith("https://")) {
        setUrl(text);
        setBatchMode(false);
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, []);

  // ── Fetch video info when URL changes (debounced) ───────────────────────
  useEffect(() => {
    if (infoDebounce.current) clearTimeout(infoDebounce.current);
    if (!url.trim() || batchMode) {
      setVideoInfo(null);
      setInfoError(false);
      setFormats([]);
      setSelectedFormat("bestvideo+bestaudio/best");
      return;
    }
    infoDebounce.current = setTimeout(async () => {
      setInfoLoading(true);
      setInfoError(false);
      setFormats([]);
      setSelectedFormat("bestvideo+bestaudio/best");
      try {
        const [infoRes, fmtRes] = await Promise.all([
          fetch(`/api/info?url=${encodeURIComponent(url.trim())}`),
          fetch(`/api/formats?url=${encodeURIComponent(url.trim())}`),
        ]);
        const [infoData, fmtData] = await Promise.all([infoRes.json(), fmtRes.json()]);
        if (infoData.error) {
          setVideoInfo(null);
          setInfoError(true);
        } else {
          setVideoInfo(infoData);
        }
        if (!fmtData.error) setFormats(fmtData.formats ?? []);
      } catch {
        setVideoInfo(null);
        setInfoError(true);
      } finally {
        setInfoLoading(false);
      }
    }, 800);
  }, [url, batchMode]);

  // ── Helpers ─────────────────────────────────────────────────────────────
  const updateDownload = useCallback((id: string, patch: Partial<ActiveDownload>) => {
    setDownloads((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  const appendLog = useCallback((id: string, line: string) => {
    setDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, logs: [...d.logs.slice(-199), line] } : d))
    );
  }, []);

  const addToast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const notify = (title: string, body: string) => {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icon-192.png" });
    }
  };

  const addToHistory = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => [entry, ...prev.slice(0, 99)]);
    fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }).catch(() => {});
  }, []);

  // ── Start single download ────────────────────────────────────────────────
  const startSingleDownload = useCallback(
    async (dlUrl: string) => {
      if (!dlUrl.trim() || !outputDir.trim()) return;
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: dlUrl.trim(),
          mode,
          quality,
          formatId: selectedFormat,
          outputDir: outputDir.trim(),
          thumbnail: videoInfo?.thumbnail ?? "",
          embedMetadata,
          embedThumbnail,
          cookiesFile: cookiesFile.trim(),
          speedLimit: speedLimit.trim(),
        }),
      });
      const { id, error } = await res.json();
      if (error || !id) return;

      const dl: ActiveDownload = {
        id,
        url: dlUrl.trim(),
        mode,
        title: videoInfo?.title || dlUrl.trim(),
        thumbnail: videoInfo?.thumbnail ?? "",
        status: "pending",
        progress: 0,
        speed: "",
        eta: "",
        error: "",
        logs: [],
        outputDir: outputDir.trim(),
      };
      setDownloads((prev) => [dl, ...prev]);

      const es = new EventSource(`/api/progress?id=${id}`);
      eventSources.current.set(id, es);

      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "progress") {
            updateDownload(id, { status: "downloading", progress: msg.progress, speed: msg.speed, eta: msg.eta });
          } else if (msg.type === "title") {
            updateDownload(id, { title: msg.title });
          } else if (msg.type === "log") {
            appendLog(id, msg.text);
          } else if (msg.type === "done") {
            updateDownload(id, { status: "done", progress: 100, speed: "", eta: "" });
            es.close();
            eventSources.current.delete(id);
            setDownloads((prev) => {
              const found = prev.find((d) => d.id === id);
              if (found) {
                notify("Download complete", found.title || dlUrl.trim());
                addToast(`Downloaded: ${found.title || dlUrl.trim()}`, "success");
                addToHistory({ id, url: dlUrl.trim(), title: found.title, thumbnail: found.thumbnail, mode, outputDir: outputDir.trim(), status: "done", completedAt: Date.now() });
              }
              return prev;
            });
          } else if (msg.type === "error") {
            updateDownload(id, { status: "error", error: msg.message });
            es.close();
            eventSources.current.delete(id);
            setDownloads((prev) => {
              const found = prev.find((d) => d.id === id);
              if (found) {
                addToHistory({ id, url: dlUrl.trim(), title: found.title, thumbnail: found.thumbnail, mode, outputDir: outputDir.trim(), status: "error", completedAt: Date.now(), error: msg.message });
              }
              return prev;
            });
          }
        } catch { /* ignore */ }
      };

      es.onerror = () => {
        updateDownload(id, { status: "error", error: "Connection lost" });
        es.close();
        eventSources.current.delete(id);
      };
    },
    [mode, quality, selectedFormat, outputDir, videoInfo, embedMetadata, embedThumbnail, cookiesFile, speedLimit, updateDownload, appendLog, addToast, addToHistory]
  );

  // ── Start download (single or batch) ────────────────────────────────────
  const startDownload = async () => {
    if (batchMode) {
      const urls = batchUrls.split("\n").map((u) => u.trim()).filter((u) => u.startsWith("http"));
      if (!urls.length) return;
      for (const u of urls) await startSingleDownload(u);
      setBatchUrls("");
    } else {
      if (!url.trim()) return;
      await startSingleDownload(url.trim());
      setUrl("");
      setVideoInfo(null);
      setFormats([]);
      setSelectedFormat("bestvideo+bestaudio/best");
    }
  };

  // ── Cancel download ──────────────────────────────────────────────────────
  const cancelDownload = async (id: string) => {
    await fetch("/api/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    const es = eventSources.current.get(id);
    if (es) { es.close(); eventSources.current.delete(id); }
    updateDownload(id, { status: "error", error: "Cancelled" });
  };

  // ── Dismiss download card ────────────────────────────────────────────────
  const dismissDownload = (id: string) => {
    setDownloads((prev) => prev.filter((d) => d.id !== id));
    setExpandedLogs((prev) => { const next = new Set(prev); next.delete(id); return next; });
  };

  // ── Open folder in Explorer ──────────────────────────────────────────────
  const openFolder = (dir: string) => {
    fetch("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: dir }),
    }).catch(() => {});
  };

  // ── Update yt-dlp ────────────────────────────────────────────────────────
  const updateYtdlp = () => {
    setUpdating(true);
    setUpdateState({ fromVersion: "", toVersion: "", status: "checking", error: "" });
    const es = new EventSource("/api/update-ytdlp");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "log") {
          const text: string = msg.text ?? "";
          const currentMatch = text.match(/Current version:\s*(\S+)/i);
          const latestMatch = text.match(/Latest version:\s*(\S+)/i);
          const updatingMatch = text.match(/Updating to\s+(\S+)/i);
          const errorMatch = text.match(/^ERROR:\s*(.+)/i);
          const upToDate = text.includes("is up to date");

          if (currentMatch) setUpdateState((p) => ({ ...p, fromVersion: currentMatch[1] }));
          if (latestMatch) setUpdateState((p) => ({ ...p, toVersion: latestMatch[1] }));
          if (updatingMatch) setUpdateState((p) => ({ ...p, status: "downloading", toVersion: p.toVersion || updatingMatch[1] }));
          if (errorMatch) setUpdateState((p) => ({ ...p, status: "error", error: errorMatch[1] }));
          if (upToDate) {
            setUpdateAvailable(false);
            setUpdateState((p) => ({ ...p, status: "up-to-date" }));
            setTimeout(() => setUpdateState({ fromVersion: "", toVersion: "", status: "idle", error: "" }), 4000);
          }
        } else if (msg.type === "done") {
          setUpdating(false);
          setUpdateAvailable(false);
          setUpdateState((p) => ({ ...p, status: p.status === "error" ? "error" : "done" }));
          if (msg.message !== "yt-dlp is up to date!") addToast("yt-dlp updated successfully", "success");
          es.close();
          setTimeout(() => setUpdateState({ fromVersion: "", toVersion: "", status: "idle", error: "" }), 4000);
        } else if (msg.type === "error") {
          setUpdating(false);
          setUpdateState((p) => ({ ...p, status: "error", error: msg.message ?? "Update failed" }));
          es.close();
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => {
      setUpdating(false);
      setUpdateState((p) => ({ ...p, status: "error", error: "Connection lost" }));
      es.close();
    };
  };

  const toggleLogs = (id: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Save settings ────────────────────────────────────────────────────────
  const saveSettings = async () => {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draftSettings),
    }).catch(() => {});
    setOutputDir(draftSettings.outputDir);
    setMode(draftSettings.defaultMode);
    setQuality(draftSettings.defaultQuality);
    setEmbedMetadata(draftSettings.embedMetadata);
    setEmbedThumbnail(draftSettings.embedThumbnail);
    setCookiesFile(draftSettings.cookiesFile);
    setSpeedLimit(draftSettings.speedLimit ?? "");
    setShowSettings(false);
    addToast("Settings saved", "success");
  };

  // ── Pick folder via Windows dialog ───────────────────────────────────────
  const pickFolder = async (onPick: (path: string) => void) => {
    try {
      const res = await fetch("/api/pick-folder");
      const { path } = await res.json();
      if (path) onPick(path);
    } catch { /* ignore */ }
  };

  // ── Clear history ─────────────────────────────────────────────────────────
  const clearHistory = async () => {
    await fetch("/api/history", { method: "DELETE" }).catch(() => {});
    setHistory([]);
  };

  // ── Apply theme ──────────────────────────────────────────────────────────
  const applyTheme = (t: Theme) => {
    setTheme(t);
    localStorage.setItem("theme", t);
  };

  const statusColor: Record<DownloadStatus, string> = {
    idle: "text-zinc-400",
    pending: "text-yellow-400",
    downloading: "text-blue-400",
    done: "text-green-400",
    error: "text-red-400",
  };

  const statusLabel: Record<DownloadStatus, string> = {
    idle: "Idle",
    pending: "Starting…",
    downloading: "Downloading",
    done: "Done",
    error: "Error",
  };

  const canDownload = batchMode
    ? batchUrls.split("\n").some((u) => u.trim().startsWith("http"))
    : !!url.trim() && !!outputDir.trim();

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-8">

      {/* ── Toast overlay ──────────────────────────────────────────────── */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-enter pointer-events-auto flex items-center gap-2.5 rounded-lg px-4 py-2.5 text-sm font-medium shadow-xl border ${
              t.type === "success"
                ? "bg-zinc-900 border-green-500/30 text-white"
                : t.type === "error"
                ? "bg-zinc-900 border-red-500/30 text-white"
                : "bg-zinc-900 border-zinc-700 text-white"
            }`}
          >
            <span className={t.type === "success" ? "text-green-400" : t.type === "error" ? "text-red-400" : "text-blue-400"}>
              {t.type === "success" ? "✓" : t.type === "error" ? "✗" : "ℹ"}
            </span>
            <span className="max-w-xs leading-snug">{t.message}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="ml-1 text-zinc-500 hover:text-zinc-300 transition-colors text-xs leading-none"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-64.png" alt="Yoink" className="w-9 h-9 rounded-lg" />
          <h1 className="text-2xl font-bold tracking-tight text-white">Yoink</h1>
        </div>
        <div className="flex items-center gap-2">
          {updateAvailable && (
            <button
              onClick={updateYtdlp}
              disabled={updating}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-xs font-medium transition-colors"
            >
              {updating ? "Updating…" : "Update yt-dlp"}
            </button>
          )}
          <button
            onClick={() => { setShowHistory(true); setShowSettings(false); }}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 transition-colors"
          >
            History
          </button>
          <button
            onClick={() => {
              setShowSettings(true);
              setShowHistory(false);
              setDraftSettings({ outputDir, defaultMode: mode, defaultQuality: quality, embedMetadata, embedThumbnail, cookiesFile, speedLimit });
            }}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 transition-colors"
          >
            ⚙ Settings
          </button>
        </div>
      </div>

      {/* ── Update progress ─────────────────────────────────────────────── */}
      {updateState.status !== "idle" && (
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-white">
              {updateState.status === "checking" && "Checking for update…"}
              {updateState.status === "downloading" && "Downloading update…"}
              {updateState.status === "done" && "Update complete"}
              {updateState.status === "up-to-date" && "yt-dlp is up to date"}
              {updateState.status === "error" && "Update failed"}
            </span>
            {(updateState.fromVersion || updateState.toVersion) && (
              <span className="text-xs text-zinc-500 font-mono">
                {updateState.fromVersion && <span>{updateState.fromVersion}</span>}
                {updateState.fromVersion && updateState.toVersion && <span className="mx-1">→</span>}
                {updateState.toVersion && <span className="text-zinc-300">{updateState.toVersion}</span>}
              </span>
            )}
          </div>

          {/* Progress bar */}
          {(updateState.status === "checking" || updateState.status === "downloading") && (
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full rounded-full bg-[var(--accent)] animate-[indeterminate_1.5s_ease-in-out_infinite]" style={{ width: "40%" }} />
            </div>
          )}
          {updateState.status === "done" && (
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: "100%" }} />
            </div>
          )}
          {updateState.status === "up-to-date" && (
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: "100%" }} />
            </div>
          )}
          {updateState.status === "error" && (
            <p className="text-xs text-red-400">{updateState.error}</p>
          )}
        </div>
      )}

      {/* ── Download form ──────────────────────────────────────────────── */}
      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-6 space-y-4">

        {/* Batch toggle */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-widest">
            {batchMode ? "Batch / Queue" : "URL"}
          </span>
          <button
            onClick={() => setBatchMode((v) => !v)}
            className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${batchMode ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
          >
            Batch mode
          </button>
        </div>

        {batchMode ? (
          <textarea
            value={batchUrls}
            onChange={(e) => setBatchUrls(e.target.value)}
            placeholder={"https://youtu.be/...\nhttps://youtu.be/...\n(one URL per line)"}
            rows={5}
            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y font-mono"
          />
        ) : (
          <>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canDownload && startDownload()}
              placeholder="https://www.youtube.com/watch?v=… (or paste anywhere)"
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              suppressHydrationWarning
            />

            {/* Video preview */}
            {(infoLoading || videoInfo || infoError) && (
              <div className="flex gap-3 rounded-lg bg-zinc-800 border border-zinc-700 p-3">
                <div className="w-32 h-[72px] rounded overflow-hidden bg-zinc-700 shrink-0 flex items-center justify-center">
                  {infoLoading ? (
                    <div className="w-5 h-5 rounded-full border-2 border-zinc-500 border-t-blue-400 animate-spin" />
                  ) : videoInfo?.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={videoInfo.thumbnail} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-zinc-500 text-xl">?</span>
                  )}
                </div>
                {!infoLoading && videoInfo && (
                  <div className="min-w-0 flex flex-col justify-center gap-1">
                    <p className="text-sm font-medium text-white line-clamp-2 leading-snug">{videoInfo.title}</p>
                    <p className="text-xs text-zinc-400">
                      {videoInfo.uploader}
                      {videoInfo.duration ? ` · ${formatDuration(videoInfo.duration)}` : ""}
                    </p>
                  </div>
                )}
                {!infoLoading && infoError && (
                  <div className="min-w-0 flex flex-col justify-center gap-1">
                    <p className="text-sm text-zinc-400">Could not load video info</p>
                    <p className="text-xs text-zinc-500">The URL may be invalid or the video unavailable</p>
                  </div>
                )}
              </div>
            )}

            {/* Format selector */}
            {formats.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Format</label>
                <select
                  value={selectedFormat}
                  onChange={(e) => setSelectedFormat(e.target.value)}
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="bestvideo+bestaudio/best">Best quality (auto)</option>
                  {formats
                    .filter((f) => f.vcodec !== "none" || f.acodec !== "none")
                    .slice()
                    .reverse()
                    .map((f) => {
                      const size = f.filesize ? ` · ${(f.filesize / 1024 / 1024).toFixed(0)}MB` : "";
                      const fps = f.fps ? ` ${f.fps}fps` : "";
                      const label = `${f.resolution}${fps} · ${f.ext}${size}`;
                      return <option key={f.format_id} value={f.format_id}>{label}</option>;
                    })}
                </select>
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* Mode */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Mode</label>
            <div className="flex rounded-lg overflow-hidden border border-zinc-700">
              {(["video", "audio"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2 text-sm font-medium capitalize transition-colors ${mode === m ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
                >
                  {m === "audio" ? "Audio (MP3)" : "Video"}
                </button>
              ))}
            </div>
          </div>

          {/* Quality */}
          {mode === "video" && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Quality</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {VIDEO_QUALITIES.map((q) => (
                  <option key={q} value={q}>{q === "best" ? "Best available" : q}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Output folder */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Output Folder</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder="C:\Users\you\Downloads"
              className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              suppressHydrationWarning
            />
            <button
              onClick={() => pickFolder(setOutputDir)}
              className="px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm text-zinc-200 transition-colors shrink-0"
              title="Browse for folder"
            >
              Browse
            </button>
          </div>
        </div>

        {/* Embed options */}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={embedMetadata}
              onChange={(e) => setEmbedMetadata(e.target.checked)}
              className="w-4 h-4 rounded accent-blue-500"
            />
            <span className="text-xs text-zinc-300">Embed metadata</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={embedThumbnail}
              onChange={(e) => setEmbedThumbnail(e.target.checked)}
              className="w-4 h-4 rounded accent-blue-500"
            />
            <span className="text-xs text-zinc-300">Embed thumbnail</span>
          </label>
        </div>

        {/* Active badges */}
        <div className="flex flex-wrap gap-2">
          {cookiesFile && (
            <div className="flex items-center gap-2 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-1.5">
              <span className="text-xs text-zinc-400">🍪 Cookies:</span>
              <span className="text-xs text-zinc-300 truncate max-w-[160px]">{cookiesFile}</span>
              <button onClick={() => setCookiesFile("")} className="text-xs text-zinc-500 hover:text-red-400 transition-colors">✕</button>
            </div>
          )}
          {speedLimit && (
            <div className="flex items-center gap-2 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-1.5">
              <span className="text-xs text-zinc-400">⚡ Limit:</span>
              <span className="text-xs text-zinc-300">{speedLimit}/s</span>
            </div>
          )}
        </div>

        <button
          onClick={startDownload}
          disabled={!canDownload}
          className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold transition-colors"
        >
          {batchMode ? `Download Queue (${batchUrls.split("\n").filter((u) => u.trim().startsWith("http")).length} URLs)` : "Download"}
        </button>
      </div>

      {/* ── Active Downloads ───────────────────────────────────────────── */}
      {downloads.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest">Downloads</h2>
          {downloads.map((dl) => (
            <div key={dl.id} className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  {dl.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={dl.thumbnail} alt="" className="w-14 h-10 rounded object-cover shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{dl.title}</p>
                    <p className="text-xs text-zinc-500 truncate mt-0.5">{dl.url}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-medium ${statusColor[dl.status]}`}>
                    {statusLabel[dl.status]}
                  </span>
                  {(dl.status === "downloading" || dl.status === "pending") && (
                    <button
                      onClick={() => cancelDownload(dl.id)}
                      className="text-xs px-2 py-0.5 rounded bg-zinc-800 hover:bg-red-900 text-zinc-400 hover:text-red-300 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                  {dl.status === "done" && (
                    <button
                      onClick={() => openFolder(dl.outputDir)}
                      className="text-xs px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                    >
                      📂 Open
                    </button>
                  )}
                  {(dl.status === "done" || dl.status === "error") && (
                    <button
                      onClick={() => dismissDownload(dl.id)}
                      className="text-xs w-5 h-5 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200 transition-colors"
                      title="Dismiss"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              {(dl.status === "downloading" || dl.status === "done") && (
                <div className="space-y-1">
                  <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden ${dl.status === "done" ? "bg-green-500" : "bg-blue-500"}`}
                      style={{ width: `${dl.progress}%` }}
                    >
                      {dl.status === "downloading" && (
                        <span
                          className="absolute inset-0"
                          style={{
                            background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.28) 50%, transparent 100%)",
                            backgroundSize: "200% 100%",
                            animation: "shimmer 1.5s linear infinite",
                          }}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span>{dl.progress.toFixed(1)}%</span>
                    {dl.speed && <span>{dl.speed} · ETA {dl.eta}</span>}
                  </div>
                </div>
              )}

              {dl.status === "error" && (
                <p className="text-xs text-red-400">{dl.error}</p>
              )}

              {/* Log toggle */}
              {dl.logs.length > 0 && (
                <div>
                  <button
                    onClick={() => toggleLogs(dl.id)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {expandedLogs.has(dl.id) ? "Hide logs ▲" : "Show logs ▼"}
                  </button>
                  {expandedLogs.has(dl.id) && (
                    <div className="mt-2 rounded-lg bg-zinc-950 border border-zinc-800 p-3 text-xs font-mono text-zinc-400 max-h-48 overflow-y-auto space-y-0.5">
                      {dl.logs.map((l, i) => <div key={i}>{l}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="text-center text-xs text-zinc-600 pb-4 space-y-0.5">
        <p>GUI v{GUI_VERSION}{buildVariant && ` · ${buildVariant}`}</p>
        <p>made by The Guy</p>
        {ytdlpVersion && <p className="text-zinc-700">yt-dlp {ytdlpVersion}</p>}
      </div>

      {/* ── Settings Drawer ─────────────────────────────────────────────── */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/50" onClick={() => setShowSettings(false)} />
          <div className="w-80 bg-zinc-950 border-l border-zinc-800 flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h2 className="text-sm font-semibold text-white">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-zinc-500 hover:text-white transition-colors text-lg leading-none">✕</button>
            </div>
            <div className="flex-1 px-5 py-4 space-y-5">

              {/* Color theme picker */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Color Theme</label>
                <div className="grid grid-cols-2 gap-2">
                  {THEMES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => applyTheme(t.value)}
                      className={`flex items-center gap-2 px-2 py-2 rounded-lg border text-left text-xs font-medium transition-colors ${
                        theme === t.value
                          ? "border-blue-500 bg-blue-500/10 text-white"
                          : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.accent }} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Default Output Folder</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={draftSettings.outputDir}
                    onChange={(e) => setDraftSettings((s) => ({ ...s, outputDir: e.target.value }))}
                    className="flex-1 min-w-0 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => pickFolder((p) => setDraftSettings((s) => ({ ...s, outputDir: p })))}
                    className="px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm text-zinc-200 transition-colors shrink-0"
                    title="Browse for folder"
                  >
                    Browse
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Default Mode</label>
                <div className="flex rounded-lg overflow-hidden border border-zinc-700">
                  {(["video", "audio"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setDraftSettings((s) => ({ ...s, defaultMode: m }))}
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${draftSettings.defaultMode === m ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
                    >
                      {m === "audio" ? "Audio" : "Video"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Default Quality</label>
                <select
                  value={draftSettings.defaultQuality}
                  onChange={(e) => setDraftSettings((s) => ({ ...s, defaultQuality: e.target.value }))}
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {VIDEO_QUALITIES.map((q) => (
                    <option key={q} value={q}>{q === "best" ? "Best available" : q}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Defaults</label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={draftSettings.embedMetadata} onChange={(e) => setDraftSettings((s) => ({ ...s, embedMetadata: e.target.checked }))} className="w-4 h-4 rounded accent-blue-500" />
                  <span className="text-sm text-zinc-300">Embed metadata</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={draftSettings.embedThumbnail} onChange={(e) => setDraftSettings((s) => ({ ...s, embedThumbnail: e.target.checked }))} className="w-4 h-4 rounded accent-blue-500" />
                  <span className="text-sm text-zinc-300">Embed thumbnail</span>
                </label>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Speed Limit</label>
                <input
                  type="text"
                  value={draftSettings.speedLimit ?? ""}
                  onChange={(e) => setDraftSettings((s) => ({ ...s, speedLimit: e.target.value }))}
                  placeholder="500K or 2M  (blank = unlimited)"
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-zinc-600">K = KB/s · M = MB/s · passed as --limit-rate</p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Cookies File</label>
                <input
                  type="text"
                  value={draftSettings.cookiesFile}
                  onChange={(e) => setDraftSettings((s) => ({ ...s, cookiesFile: e.target.value }))}
                  placeholder="C:\path\to\cookies.txt"
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-zinc-600">Export from browser with a cookies extension</p>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-zinc-800">
              <button
                onClick={saveSettings}
                className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-semibold transition-colors"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── History Drawer ──────────────────────────────────────────────── */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/50" onClick={() => setShowHistory(false)} />
          <div className="w-96 bg-zinc-950 border-l border-zinc-800 flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
              <h2 className="text-sm font-semibold text-white">Download History</h2>
              <div className="flex items-center gap-2">
                {history.length > 0 && (
                  <button onClick={clearHistory} className="text-xs text-zinc-500 hover:text-red-400 transition-colors">Clear all</button>
                )}
                <button onClick={() => setShowHistory(false)} className="text-zinc-500 hover:text-white transition-colors text-lg leading-none">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {history.length === 0 ? (
                <p className="text-center text-sm text-zinc-600 mt-12">No downloads yet</p>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {history.map((entry) => (
                    <div key={entry.id} className="px-5 py-3 flex items-start gap-3 hover:bg-zinc-900 transition-colors">
                      {entry.thumbnail && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={entry.thumbnail} alt="" className="w-16 h-10 rounded object-cover shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white truncate leading-snug">{entry.title || entry.url}</p>
                        <p className="text-xs text-zinc-500 mt-0.5 truncate">{entry.url}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs font-medium ${entry.status === "done" ? "text-green-400" : "text-red-400"}`}>
                            {entry.status === "done" ? "✓ Done" : "✗ Error"}
                          </span>
                          <span className="text-xs text-zinc-600">{timeAgo(entry.completedAt)}</span>
                          <span className="text-xs text-zinc-600 capitalize">{entry.mode}</span>
                        </div>
                        {entry.error && <p className="text-xs text-red-400 mt-0.5 truncate">{entry.error}</p>}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          onClick={() => { setUrl(entry.url); setShowHistory(false); setBatchMode(false); }}
                          className="text-xs px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                        >
                          Re-use
                        </button>
                        <button
                          onClick={() => openFolder(entry.outputDir)}
                          className="text-xs px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                        >
                          📂
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
