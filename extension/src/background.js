'use strict';

const NMH_NAME = 'com.yoink.helper';

// ---------------------------------------------------------------------------
// Install — context menu
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'yoink-video',
    title: 'Yoink this video',
    contexts: ['page', 'link', 'video'],
    documentUrlPatterns: ['<all_urls>']
  });
});

// ---------------------------------------------------------------------------
// Context menu click — quick download (video, best quality)
// ---------------------------------------------------------------------------
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'yoink-video') return;
  const url = info.linkUrl || info.srcUrl || info.pageUrl;
  chrome.runtime.sendNativeMessage(NMH_NAME, {
    action: 'download',
    url,
    mode: 'video',
    quality: 'best'
  }, response => {
    if (chrome.runtime.lastError) {
      console.error('[Yoink] NMH error:', chrome.runtime.lastError.message);
    }
  });
});

// ---------------------------------------------------------------------------
// Message listener — from popup
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'download':
      handleDownload(msg, sendResponse);
      return true; // keep channel open

    case 'getSettings':
    case 'getHistory':
    case 'clearHistory':
    case 'checkYtdlp':
      handleSingleResponse(msg.type, sendResponse);
      return true;

    default:
      return false;
  }
});

// ---------------------------------------------------------------------------
// Single-response actions via sendNativeMessage
// ---------------------------------------------------------------------------
function actionForType(type) {
  const map = {
    getSettings: 'getSettings',
    getHistory: 'getHistory',
    clearHistory: 'clearHistory',
    checkYtdlp: 'checkYtdlp'
  };
  return map[type] || type;
}

function handleSingleResponse(type, sendResponse) {
  chrome.runtime.sendNativeMessage(NMH_NAME, { action: actionForType(type) }, response => {
    if (chrome.runtime.lastError) {
      sendResponse({ type: 'error', message: chrome.runtime.lastError.message });
      return;
    }
    sendResponse(response);
  });
}

// ---------------------------------------------------------------------------
// Download — streaming via connectNative port
// ---------------------------------------------------------------------------
function handleDownload(msg, sendResponse) {
  let port;
  try {
    port = chrome.runtime.connectNative(NMH_NAME);
  } catch (err) {
    sendResponse({ type: 'error', message: String(err) });
    return;
  }

  // Relay all messages from the native host back to the popup.
  // We use sendResponse once for the first message, then broadcast
  // subsequent messages to all popup tabs via chrome.runtime.sendMessage.
  let firstSent = false;

  port.onMessage.addListener(nmMsg => {
    if (!firstSent) {
      firstSent = true;
      sendResponse(nmMsg);
    } else {
      // Relay to any open popup
      chrome.runtime.sendMessage(nmMsg).catch(() => {});
    }
    // After done/error the native host exits; disconnect port cleanly.
    if (nmMsg.type === 'done' || nmMsg.type === 'error') {
      port.disconnect();
    }
  });

  port.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError) {
      if (!firstSent) {
        sendResponse({ type: 'error', message: chrome.runtime.lastError.message });
      } else {
        chrome.runtime.sendMessage({ type: 'error', message: chrome.runtime.lastError.message }).catch(() => {});
      }
    }
  });

  port.postMessage({
    action: 'download',
    url: msg.url,
    mode: msg.mode || 'video',
    quality: msg.quality || 'best',
    outputDir: msg.outputDir || undefined,
    filenameTemplate: msg.filenameTemplate || undefined,
    subtitles: msg.subtitles || undefined,
    cookies: msg.cookies || undefined
  });
}
