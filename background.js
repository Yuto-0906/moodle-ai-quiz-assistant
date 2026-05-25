'use strict';

// tabId → { sendResponse, prompt, images }
const pending = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── Quiz page asks us to open an AI tab ──────────────────────
  if (msg.action === 'askWebAI') {
    const url = msg.provider === 'chatgpt'
      ? 'https://chatgpt.com/'
      : 'https://gemini.google.com/app';

    chrome.tabs.create({ url, active: true }, tab => {
      pending.set(tab.id, {
        sendResponse,
        prompt: msg.prompt,
        images: Array.isArray(msg.images) ? msg.images : []
      });
    });
    return true; // keep sendResponse alive asynchronously
  }

  // ── AI content script signals it's ready ─────────────────────
  if (msg.action === 'webAIReady') {
    const req = pending.get(sender.tab.id);
    if (req) {
      sendResponse({ prompt: req.prompt, images: req.images });
    } else {
      sendResponse(null); // no pending task — content script will exit early
    }
    return true;
  }

  // ── AI content script sends back the response text ───────────
  if (msg.action === 'webAIDone') {
    const req = pending.get(sender.tab.id);
    if (req) {
      req.sendResponse({ success: true, text: msg.text });
      pending.delete(sender.tab.id);
      // Close AI tab after a brief delay so the user can see it finished
      setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => {}), 2000);
    }
  }

  // ── AI content script reports an error ───────────────────────
  if (msg.action === 'webAIError') {
    const req = pending.get(sender.tab.id);
    if (req) {
      req.sendResponse({ success: false, error: msg.error });
      pending.delete(sender.tab.id);
      chrome.tabs.remove(sender.tab.id).catch(() => {});
    }
  }
});

// If the user manually closes the AI tab, report an error to the quiz page
chrome.tabs.onRemoved.addListener(tabId => {
  const req = pending.get(tabId);
  if (req) {
    req.sendResponse({ success: false, error: 'AIタブが閉じられました。もう一度お試しください。' });
    pending.delete(tabId);
  }
});
