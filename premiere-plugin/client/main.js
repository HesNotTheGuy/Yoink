'use strict';

// ---------------------------------------------------------------------------
// Node.js modules (available in CEP panel with --enable-nodejs --mixed-context)
// ---------------------------------------------------------------------------
var fs = require('fs');
var path = require('path');
var os = require('os');
var child_process = require('child_process');

var csInterface = new CSInterface();

// ---------------------------------------------------------------------------
// Shared Yoink data directory (matches the desktop app and the extension)
// ---------------------------------------------------------------------------
function getDataDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA, 'Yoink');
  return path.join(os.homedir(), '.yoink');
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function getYtdlpPath() {
  var dataDir = getDataDir();
  var bin = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  var local = path.join(dataDir, bin);
  if (fs.existsSync(local)) return local;
  return bin; // fall back to PATH
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function $(id) { return document.getElementById(id); }

function timeAgo(epoch) {
  var secs = Math.floor(Date.now() / 1000) - epoch;
  if (secs < 60) return secs + 's ago';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
  if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
  return Math.floor(secs / 86400) + 'd ago';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
var currentMode = 'video';
var downloading = false;
var projectPath = '';
var projectDir = '';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
var statusDot     = $('statusDot');
var projectName   = $('projectName');
var urlInput      = $('urlInput');
var btnVideo      = $('btnVideo');
var btnAudio      = $('btnAudio');
var qualityRow    = $('qualityRow');
var qualitySelect = $('qualitySelect');
var autoImport    = $('autoImport');
var filenameTpl   = $('filenameTpl');
var subsEnabled   = $('subsEnabled');
var subsOptions   = $('subsOptions');
var subsLang      = $('subsLang');
var cookiesFile   = $('cookiesFile');
var dlBtn         = $('dlBtn');
var progressSec   = $('progressSection');
var progressTitle = $('progressTitle');
var progressFill  = $('progressFill');
var progressSpeed = $('progressSpeed');
var progressEta   = $('progressEta');
var progressStat  = $('progressStatus');
var historyList   = $('historyList');

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------
function setMode(mode) {
  currentMode = mode;
  if (mode === 'video') {
    btnVideo.classList.add('active');
    btnAudio.classList.remove('active');
    qualityRow.style.display = '';
  } else {
    btnAudio.classList.add('active');
    btnVideo.classList.remove('active');
    qualityRow.style.display = 'none';
  }
}

btnVideo.addEventListener('click', function () { setMode('video'); });
btnAudio.addEventListener('click', function () { setMode('audio'); });
subsEnabled.addEventListener('change', function () {
  subsOptions.classList.toggle('hidden', !subsEnabled.checked);
});

urlInput.addEventListener('input', function () {
  dlBtn.disabled = !urlInput.value.trim() || downloading;
});

// ---------------------------------------------------------------------------
// Project path — fetched from Premiere via ExtendScript
// ---------------------------------------------------------------------------
function refreshProject() {
  csInterface.evalScript('yoinkGetProjectPath()', function (result) {
    if (!result || result === 'undefined' || result === 'null' || result === '') {
      projectPath = '';
      projectDir  = '';
      projectName.textContent = 'No project open';
      return;
    }
    projectPath = result;
    projectDir = path.dirname(result);
    projectName.textContent = path.basename(result);
  });
}

// ---------------------------------------------------------------------------
// yt-dlp check
// ---------------------------------------------------------------------------
function checkYtdlp() {
  var ytdlp = getYtdlpPath();
  try {
    var out = child_process.execFileSync(ytdlp, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
    statusDot.className = 'status-dot ok';
    statusDot.title = 'yt-dlp ' + out + ' (' + ytdlp + ')';
  } catch (e) {
    statusDot.className = 'status-dot err';
    statusDot.title = 'yt-dlp not found — install it or place yt-dlp.exe in %APPDATA%\\Yoink\\';
  }
}

// ---------------------------------------------------------------------------
// History (shared with app + extension)
// ---------------------------------------------------------------------------
function readHistory() {
  var file = path.join(getDataDir(), 'history.json');
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; }
}

function writeHistory(entries) {
  ensureDir(getDataDir());
  var file = path.join(getDataDir(), 'history.json');
  fs.writeFileSync(file, JSON.stringify(entries, null, 2), 'utf8');
}

function addHistoryEntry(entry) {
  var entries = readHistory();
  entries.unshift(entry);
  if (entries.length > 100) entries.splice(100);
  writeHistory(entries);
}

function renderHistory() {
  var entries = readHistory().slice(0, 5);
  if (entries.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No downloads yet.</div>';
    return;
  }
  historyList.innerHTML = entries.map(function (e) {
    var title = e.title || e.url || 'Unknown';
    var when = e.completedAt ? timeAgo(e.completedAt) : '';
    return '<div class="history-item">' +
           '<span class="history-item-title" title="' + escHtml(title) + '">' + escHtml(title) + '</span>' +
           '<span class="history-time">' + escHtml(when) + '</span>' +
           '</div>';
  }).join('');
}

// ---------------------------------------------------------------------------
// yt-dlp arg builders
// ---------------------------------------------------------------------------
function buildFormatArgs(mode, quality) {
  if (mode === 'audio') {
    return ['-x', '--audio-format', 'mp3', '--audio-quality', '0'];
  }
  var fmtMap = {
    best:    'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '1080p': 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]',
    '720p':  'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]',
    '480p':  'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]',
    '360p':  'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]'
  };
  return ['-f', fmtMap[quality] || fmtMap.best, '--merge-output-format', 'mp4'];
}

function buildSubtitleArgs(mode) {
  if (!subsEnabled.checked) return [];
  var args = ['--write-subs', '--write-auto-subs', '--sub-langs', (subsLang.value || 'en').trim()];
  var modeRadio = document.querySelector('input[name="subsMode"]:checked');
  if (modeRadio && modeRadio.value === 'embed' && mode === 'video') {
    args.push('--embed-subs');
  } else {
    args.push('--convert-subs', 'srt');
  }
  return args;
}

// ---------------------------------------------------------------------------
// Progress UI
// ---------------------------------------------------------------------------
function showProgress() { progressSec.classList.remove('hidden'); dlBtn.style.display = 'none'; }
function hideProgress() { progressSec.classList.add('hidden');    dlBtn.style.display = ''; }
function resetProgress() {
  progressFill.style.width = '0%';
  progressTitle.textContent = 'Starting...';
  progressSpeed.textContent = '';
  progressEta.textContent   = '';
  progressStat.textContent  = '';
  progressStat.className    = 'progress-status';
}

// ---------------------------------------------------------------------------
// Download flow
// ---------------------------------------------------------------------------
var RE_PROGRESS = /\[download\]\s+([\d.]+)%\s+of\s+[\d.]+\S+\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/;
var RE_YOINK_PATH = /^\[YOINK_PATH\](.+)$/;

function startDownload() {
  if (downloading) return;
  var url = urlInput.value.trim();
  if (!url) return;

  if (!projectDir) {
    alert('No active project. Open or save a Premiere project first.');
    return;
  }

  var outputDir = path.join(projectDir, 'Yoink Downloads');
  ensureDir(outputDir);

  // Filename template
  var template = (filenameTpl.value || '').trim() || '%(title)s';
  if (template.indexOf('%(ext)s') === -1) template += '.%(ext)s';
  var outputTemplate = path.join(outputDir, template);

  // Build args
  var args = []
    .concat(buildFormatArgs(currentMode, qualitySelect.value))
    .concat(buildSubtitleArgs(currentMode));

  args.push('--newline');
  args.push('--print', 'after_move:[YOINK_PATH]%(filepath)s');
  args.push('--no-simulate'); // ensure --print doesn't suppress the download

  if (cookiesFile.value.trim()) {
    args.push('--cookies', cookiesFile.value.trim());
  }

  args.push('-o', outputTemplate, url);

  downloading = true;
  dlBtn.disabled = true;
  resetProgress();
  showProgress();
  progressTitle.textContent = url;

  var ytdlp = getYtdlpPath();
  var child;
  try {
    child = child_process.spawn(ytdlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    progressStat.textContent = 'Failed to launch yt-dlp: ' + e.message;
    progressStat.className = 'progress-status error';
    downloading = false;
    dlBtn.disabled = false;
    return;
  }

  var stdoutBuf = '';
  var stderrBuf = '';
  var detectedTitle = '';
  var finalFilepath = '';

  function parseLine(line) {
    var mPath = RE_YOINK_PATH.exec(line);
    if (mPath) {
      finalFilepath = mPath[1].trim();
      return;
    }
    var mProg = RE_PROGRESS.exec(line);
    if (mProg) {
      progressFill.style.width = mProg[1] + '%';
      progressSpeed.textContent = mProg[2];
      progressEta.textContent = 'ETA ' + mProg[3];
    }
    // Detect title from Destination line
    var mDest = /Destination:\s*.*[\/\\]([^\/\\]+)$/.exec(line);
    if (mDest && !detectedTitle) {
      detectedTitle = mDest[1];
      progressTitle.textContent = detectedTitle;
    }
  }

  child.stdout.on('data', function (chunk) {
    stdoutBuf += chunk.toString('utf8');
    var lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop();
    for (var i = 0; i < lines.length; i++) parseLine(lines[i].trim());
  });

  child.stderr.on('data', function (chunk) { stderrBuf += chunk.toString('utf8'); });

  child.on('close', function (code) {
    if (stdoutBuf.trim()) parseLine(stdoutBuf.trim());

    if (code === 0) {
      progressFill.style.width = '100%';
      progressStat.textContent = autoImport.checked ? 'Downloaded — importing to bin...' : 'Done!';
      progressStat.className = 'progress-status done';

      addHistoryEntry({
        id: String(Date.now()),
        url: url,
        title: detectedTitle || finalFilepath || url,
        thumbnail: '',
        mode: currentMode,
        outputDir: outputDir,
        status: 'done',
        completedAt: Math.floor(Date.now() / 1000)
      });
      renderHistory();

      if (autoImport.checked && finalFilepath && fs.existsSync(finalFilepath)) {
        importToProject(finalFilepath);
      } else {
        finishDownload();
      }
    } else {
      progressStat.textContent = 'Error: ' + (stderrBuf.trim().split('\n').pop() || 'yt-dlp exited ' + code);
      progressStat.className = 'progress-status error';
      finishDownload();
    }
  });

  child.on('error', function (err) {
    progressStat.textContent = 'Failed to spawn yt-dlp: ' + err.message;
    progressStat.className = 'progress-status error';
    finishDownload();
  });
}

function importToProject(filePath) {
  // Escape backslashes and quotes for JSX string literal
  var escaped = filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  csInterface.evalScript("yoinkImportToBin('" + escaped + "')", function (result) {
    if (result === 'ok') {
      progressStat.textContent = 'Imported into "Yoink Downloads" bin.';
    } else {
      progressStat.textContent = 'Downloaded, but import failed: ' + result;
    }
    finishDownload();
  });
}

function finishDownload() {
  downloading = false;
  dlBtn.disabled = !urlInput.value.trim();
  dlBtn.style.display = '';
}

dlBtn.addEventListener('click', startDownload);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function init() {
  checkYtdlp();
  refreshProject();
  renderHistory();
  // Refresh project info periodically — Premiere doesn't fire a "project changed" event we can hook cheaply
  setInterval(refreshProject, 2500);
}
init();
