#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Data directory
// ---------------------------------------------------------------------------
function getDataDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA, 'Yoink');
  }
  return path.join(os.homedir(), '.yoink');
}

function ensureDataDir() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// yt-dlp binary lookup
// ---------------------------------------------------------------------------
function getYtdlpPath() {
  const dataDir = getDataDir();
  const bin = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const local = path.join(dataDir, bin);
  if (fs.existsSync(local)) return local;
  return bin; // fall back to PATH
}

// ---------------------------------------------------------------------------
// Native messaging protocol (4-byte LE length prefix + UTF-8 JSON)
// ---------------------------------------------------------------------------
function readMessage(callback) {
  const chunks = [];
  let needed = 4;
  let header = null;

  function onData(chunk) {
    chunks.push(chunk);
    const buf = Buffer.concat(chunks);

    if (!header) {
      if (buf.length < 4) return;
      needed = buf.readUInt32LE(0);
      header = buf.slice(0, 4);
      const rest = buf.slice(4);
      chunks.length = 0;
      if (rest.length) chunks.push(rest);
    }

    const body = Buffer.concat(chunks);
    if (body.length >= needed) {
      process.stdin.removeListener('data', onData);
      const json = body.slice(0, needed).toString('utf8');
      callback(JSON.parse(json));
    }
  }

  process.stdin.on('data', onData);
}

function sendMessage(obj) {
  const json = JSON.stringify(obj);
  const buf = Buffer.from(json, 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------
function readSettings() {
  const file = path.join(getDataDir(), 'settings.json');
  if (!fs.existsSync(file)) {
    return {
      outputDir: path.join(os.homedir(), 'Downloads'),
      defaultMode: 'video',
      defaultQuality: 'best',
      embedMetadata: true,
      embedThumbnail: false
    };
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// History helpers
// ---------------------------------------------------------------------------
function readHistory() {
  const file = path.join(getDataDir(), 'history.json');
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function writeHistory(entries) {
  const file = path.join(getDataDir(), 'history.json');
  fs.writeFileSync(file, JSON.stringify(entries, null, 2), 'utf8');
}

function addHistoryEntry(entry) {
  const entries = readHistory();
  entries.unshift(entry);
  if (entries.length > 100) entries.splice(100);
  writeHistory(entries);
}

// ---------------------------------------------------------------------------
// yt-dlp format args
// ---------------------------------------------------------------------------
function buildFormatArgs(mode, quality) {
  if (mode === 'audio') {
    return ['-x', '--audio-format', 'mp3', '--audio-quality', '0'];
  }
  const fmtMap = {
    best: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '1080p': 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]',
    '720p': 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]',
    '480p': 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]',
    '360p': 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]'
  };
  const fmt = fmtMap[quality] || fmtMap['best'];
  return ['-f', fmt, '--merge-output-format', 'mp4'];
}

// ---------------------------------------------------------------------------
// Subtitle args
// ---------------------------------------------------------------------------
function buildSubtitleArgs(subs, mode) {
  if (!subs || !subs.enabled) return [];
  const args = ['--write-subs', '--write-auto-subs', '--sub-langs', subs.lang || 'en'];
  // Embed only makes sense for video downloads and yt-dlp will only embed
  // into supported containers (mp4/mkv/webm); harmless if unsupported.
  if (subs.embed && mode === 'video') {
    args.push('--embed-subs');
  } else {
    args.push('--convert-subs', 'srt');
  }
  return args;
}

// ---------------------------------------------------------------------------
// Cookies — write to a temp file we delete after the download
// ---------------------------------------------------------------------------
function writeCookiesFile(cookiesText) {
  const tmp = path.join(os.tmpdir(), `yoink-cookies-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(tmp, cookiesText, { encoding: 'utf8', mode: 0o600 });
  return tmp;
}

function safeUnlink(file) {
  if (!file) return;
  try { fs.unlinkSync(file); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Progress / title regexes
// ---------------------------------------------------------------------------
const RE_PROGRESS = /\[download\]\s+([\d.]+)%\s+of\s+[\d.]+\S+\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/;
const RE_TITLE = /\[(?:download|info)\].*Destination:\s*.*[/\\](.+)$/;

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------
function handleCheckYtdlp() {
  const ytdlp = getYtdlpPath();
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync(ytdlp, ['--version'], { encoding: 'utf8' }).trim();
    sendMessage({ type: 'ytdlp', found: true, path: ytdlp, version: out });
  } catch {
    sendMessage({ type: 'ytdlp', found: false, path: ytdlp, version: null });
  }
  process.exit(0);
}

function handleGetSettings() {
  sendMessage({ type: 'settings', data: readSettings() });
  process.exit(0);
}

function handleGetHistory() {
  sendMessage({ type: 'history', data: readHistory() });
  process.exit(0);
}

function handleClearHistory() {
  writeHistory([]);
  sendMessage({ type: 'success' });
  process.exit(0);
}

function handleDownload(msg) {
  const settings = readSettings();
  const outputDir = msg.outputDir || settings.outputDir || path.join(os.homedir(), 'Downloads');
  const mode = msg.mode || 'video';
  const quality = msg.quality || 'best';
  const url = msg.url;

  ensureDataDir();

  const ytdlp = getYtdlpPath();

  // Filename template — default to %(title)s; ensure .%(ext)s is included
  let template = (msg.filenameTemplate || '').trim() || '%(title)s';
  if (!template.includes('%(ext)s')) template += '.%(ext)s';
  const outputTemplate = path.join(outputDir, template);

  // Temp cookies file (if provided) — deleted in the close handler
  let cookiesFile = null;
  if (msg.cookies && typeof msg.cookies === 'string' && msg.cookies.length > 0) {
    try {
      cookiesFile = writeCookiesFile(msg.cookies);
    } catch (e) {
      sendMessage({ type: 'error', message: `Failed to write cookies file: ${e.message}` });
      process.exit(0);
      return;
    }
  }

  const args = [
    ...buildFormatArgs(mode, quality),
    ...buildSubtitleArgs(msg.subtitles, mode),
    '--newline',
    '-o', outputTemplate,
    url
  ];
  if (cookiesFile) args.splice(args.length - 1, 0, '--cookies', cookiesFile);

  const child = spawn(ytdlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let detectedTitle = '';
  const id = String(Date.now());

  function parseLine(line) {
    const mProg = RE_PROGRESS.exec(line);
    if (mProg) {
      sendMessage({
        type: 'progress',
        percent: parseFloat(mProg[1]),
        speed: mProg[2],
        eta: mProg[3]
      });
    }
    const mTitle = RE_TITLE.exec(line);
    if (mTitle) {
      detectedTitle = mTitle[1];
      sendMessage({ type: 'title', title: detectedTitle });
    }
  }

  let stdoutBuf = '';
  child.stdout.on('data', chunk => {
    stdoutBuf += chunk.toString('utf8');
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop(); // keep incomplete last line
    for (const line of lines) parseLine(line.trim());
  });

  let stderrBuf = '';
  child.stderr.on('data', chunk => { stderrBuf += chunk.toString('utf8'); });

  child.on('close', code => {
    safeUnlink(cookiesFile);

    // flush remaining stdout
    if (stdoutBuf.trim()) parseLine(stdoutBuf.trim());

    if (code === 0) {
      const entry = {
        id,
        url,
        title: detectedTitle || url,
        thumbnail: '',
        mode,
        outputDir,
        status: 'done',
        completedAt: Math.floor(Date.now() / 1000)
      };
      addHistoryEntry(entry);
      sendMessage({ type: 'done', title: detectedTitle || url, outputDir });
    } else {
      const errMsg = stderrBuf.trim() || `yt-dlp exited with code ${code}`;
      sendMessage({ type: 'error', message: errMsg });
    }
    process.exit(0);
  });

  child.on('error', err => {
    safeUnlink(cookiesFile);
    sendMessage({ type: 'error', message: `Failed to spawn yt-dlp: ${err.message}` });
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
readMessage(msg => {
  switch (msg.action) {
    case 'checkYtdlp':   handleCheckYtdlp(); break;
    case 'getSettings':  handleGetSettings(); break;
    case 'getHistory':   handleGetHistory(); break;
    case 'clearHistory': handleClearHistory(); break;
    case 'download':     handleDownload(msg); break;
    default:
      sendMessage({ type: 'error', message: `Unknown action: ${msg.action}` });
      process.exit(0);
  }
});
