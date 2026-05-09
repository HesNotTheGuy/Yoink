'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function $(id) { return document.getElementById(id); }

function truncateUrl(url, max = 48) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const display = u.hostname + u.pathname;
    return display.length > max ? display.slice(0, max) + '…' : display;
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url;
  }
}

function timeAgo(epoch) {
  const secs = Math.floor(Date.now() / 1000) - epoch;
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentUrl = '';
let currentMode = 'video';
let downloading = false;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const urlDisplay    = $('urlDisplay');
const statusDot     = $('statusDot');
const btnVideo      = $('btnVideo');
const btnAudio      = $('btnAudio');
const qualityRow    = $('qualityRow');
const qualitySelect = $('qualitySelect');
const dlBtn         = $('dlBtn');
const progressSec   = $('progressSection');
const progressTitle = $('progressTitle');
const progressFill  = $('progressFill');
const progressSpeed = $('progressSpeed');
const progressEta   = $('progressEta');
const progressStat  = $('progressStatus');
const historyList   = $('historyList');

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

btnVideo.addEventListener('click', () => setMode('video'));
btnAudio.addEventListener('click', () => setMode('audio'));

// ---------------------------------------------------------------------------
// Progress helpers
// ---------------------------------------------------------------------------
function showProgress() {
  progressSec.classList.remove('hidden');
  dlBtn.style.display = 'none';
}

function hideProgress() {
  progressSec.classList.add('hidden');
  dlBtn.style.display = '';
}

function resetProgress() {
  progressFill.style.width = '0%';
  progressTitle.textContent = 'Starting...';
  progressSpeed.textContent = '';
  progressEta.textContent = '';
  progressStat.textContent = '';
  progressStat.className = 'progress-status';
}

function updateProgress(msg) {
  if (msg.type === 'progress') {
    progressFill.style.width = `${msg.percent}%`;
    progressSpeed.textContent = msg.speed || '';
    progressEta.textContent = msg.eta ? `ETA ${msg.eta}` : '';
  } else if (msg.type === 'title') {
    progressTitle.textContent = msg.title || '';
  } else if (msg.type === 'done') {
    progressFill.style.width = '100%';
    progressStat.textContent = 'Done!';
    progressStat.className = 'progress-status done';
    progressSpeed.textContent = '';
    progressEta.textContent = '';
    dlBtn.disabled = false;
    dlBtn.style.display = '';
    downloading = false;
    // Refresh history
    loadHistory();
  } else if (msg.type === 'error') {
    progressStat.textContent = `Error: ${msg.message}`;
    progressStat.className = 'progress-status error';
    dlBtn.disabled = false;
    dlBtn.style.display = '';
    downloading = false;
  }
}

// ---------------------------------------------------------------------------
// History rendering
// ---------------------------------------------------------------------------
function renderHistory(entries) {
  if (!entries || entries.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No downloads yet.</div>';
    return;
  }
  const recent = entries.slice(0, 5);
  historyList.innerHTML = recent.map(e => {
    const badgeClass = e.mode === 'audio' ? 'badge badge-audio' : 'badge badge-video';
    const time = e.completedAt ? timeAgo(e.completedAt) : '';
    const title = e.title || e.url || 'Unknown';
    return `
      <div class="history-item">
        <span class="history-item-title" title="${escHtml(title)}">${escHtml(title)}</span>
        <span class="${badgeClass}">${escHtml(e.mode || 'video')}</span>
        <span class="history-time">${escHtml(time)}</span>
      </div>`;
  }).join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadHistory() {
  chrome.runtime.sendMessage({ type: 'getHistory' }, response => {
    if (chrome.runtime.lastError) return;
    if (response && response.type === 'history') {
      renderHistory(response.data);
    }
  });
}

// ---------------------------------------------------------------------------
// Helper status check
// ---------------------------------------------------------------------------
function checkHelper() {
  chrome.runtime.sendMessage({ type: 'checkYtdlp' }, response => {
    if (chrome.runtime.lastError || !response) {
      statusDot.className = 'status-dot err';
      statusDot.title = 'Helper not found';
      return;
    }
    if (response.type === 'ytdlp' && response.found) {
      statusDot.className = 'status-dot ok';
      statusDot.title = `yt-dlp ${response.version} found`;
    } else {
      statusDot.className = 'status-dot err';
      statusDot.title = 'yt-dlp not found';
    }
  });
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------
dlBtn.addEventListener('click', () => {
  if (downloading) return;
  if (!currentUrl) {
    alert('No URL detected on this page.');
    return;
  }
  downloading = true;
  dlBtn.disabled = true;
  resetProgress();
  showProgress();

  chrome.runtime.sendMessage({
    type: 'download',
    url: currentUrl,
    mode: currentMode,
    quality: qualitySelect.value
  }, firstMsg => {
    if (chrome.runtime.lastError) {
      progressStat.textContent = `Error: ${chrome.runtime.lastError.message}`;
      progressStat.className = 'progress-status error';
      dlBtn.disabled = false;
      dlBtn.style.display = '';
      downloading = false;
      return;
    }
    if (firstMsg) updateProgress(firstMsg);
  });
});

// ---------------------------------------------------------------------------
// Listen for streamed progress messages relayed from background
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg) => {
  if (!downloading) return;
  if (['progress', 'title', 'done', 'error'].includes(msg.type)) {
    updateProgress(msg);
  }
});

// ---------------------------------------------------------------------------
// Init — get current tab URL via content script
// ---------------------------------------------------------------------------
async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'getVideoUrl' }, response => {
        if (chrome.runtime.lastError) {
          currentUrl = tab.url || '';
        } else {
          currentUrl = (response && response.url) ? response.url : (tab.url || '');
        }
        urlDisplay.textContent = truncateUrl(currentUrl) || 'No URL';
      });
    }
  } catch {
    urlDisplay.textContent = 'No URL';
  }

  checkHelper();
  loadHistory();
}

init();
