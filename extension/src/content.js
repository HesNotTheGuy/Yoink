'use strict';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getVideoUrl') {
    sendResponse({ url: window.location.href });
    return false;
  }
  if (msg.type === 'getPageTitle') {
    sendResponse({ title: document.title });
    return false;
  }
});
