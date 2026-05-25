'use strict';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function imageToFile(image) {
  const binary = atob(image.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = (image.mimeType || 'image/png').split('/')[1]?.split('+')[0] || 'png';
  return new File([bytes], `moodle-slot-${image.slot}-image-${image.index}.${ext}`, {
    type: image.mimeType || 'image/png'
  });
}

function getImageCountFromPrompt(prompt) {
  return (prompt.match(/\[slot:\d+ image:\d+\]/g) || []).length;
}

async function waitForElement(selectors, timeout = 20000) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of list) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (_) {}
    }
    await sleep(300);
  }
  throw new Error(`Gemini: 要素が見つかりませんでした → ${list.join(' / ')}`);
}

function getPromptInput() {
  return document.querySelector('.ql-editor[contenteditable="true"]') ||
    document.querySelector('rich-textarea [contenteditable="true"]') ||
    document.querySelector('[contenteditable="true"][role="textbox"]') ||
    document.querySelector('[contenteditable="true"]');
}

function countComposerImages() {
  const selectors = [
    '[data-test-id*="file"]',
    '[data-testid*="file"]',
    '[data-test-id*="attachment"]',
    '[data-testid*="attachment"]',
    '[class*="attachment"]',
    '[class*="upload"]',
    '[class*="file"]',
    'img[src^="blob:"]',
    'img[src^="data:image"]',
    'img[alt*="Uploaded" i]',
    'img[alt*="添付" i]'
  ];

  const nodes = new Set();
  selectors.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 8 && rect.height > 8) nodes.add(el);
      });
    } catch (_) {}
  });
  return nodes.size;
}

async function waitForComposerImages(previousCount, expectedCount, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const count = countComposerImages();
    if (count >= previousCount + Math.min(expectedCount, 1)) return true;
    await sleep(500);
  }
  return false;
}

function getSendButton() {
  const selectors = [
    'button.send-button',
    'button[data-testid*="send" i]',
    'button[data-test-id*="send" i]',
    'button[aria-label="Send message"]',
    'button[aria-label="メッセージを送信"]',
    'button[aria-label="送信"]',
    'button[aria-label*="send" i]',
    'button[aria-label*="送信"]',
    '[role="button"][aria-label*="send" i]',
    '[role="button"][aria-label*="送信"]',
    'button[data-mat-icon-name="send"]',
    '[data-mat-icon-name="send"]',
    'mat-icon[data-mat-icon-name="send"]',
    'mat-icon[fonticon="send"]',
    'mat-icon:has(svg)',
    'button:has(mat-icon)'
  ];

  for (const sel of selectors) {
    try {
      const nodes = Array.from(document.querySelectorAll(sel));
      for (const node of nodes) {
        const text = `${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`.toLowerCase();
        const iconName = `${node.getAttribute('data-mat-icon-name') || ''} ${node.getAttribute('fonticon') || ''}`.toLowerCase();
        const btn = node.closest('button, [role="button"]') ?? node;
        const btnText = `${btn.getAttribute('aria-label') || ''} ${btn.textContent || ''}`.toLowerCase();
        const looksLikeSend =
          text.includes('send') || text.includes('送信') ||
          iconName.includes('send') ||
          btnText.includes('send') || btnText.includes('送信') ||
          btn.className?.toString().toLowerCase().includes('send');

        if (looksLikeSend && isVisible(btn)) return btn;
      }
    } catch (_) {}
  }
  return null;
}

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function isSendButtonReady(btn) {
  if (!btn) return false;
  const ariaDisabled = btn.getAttribute('aria-disabled') === 'true';
  const className = btn.className?.toString().toLowerCase() || '';
  return !btn.disabled && !ariaDisabled && !className.includes('disabled');
}

async function waitForUploadsToSettle(imageCount) {
  if (!imageCount) return;

  const minWait = Math.min(2500 + imageCount * 700, 7000);
  console.log('[Moodle AI] Gemini: waiting briefly for image upload settle, ms =', minWait);
  await sleep(minWait);

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const btn = getSendButton();
    if (isSendButtonReady(btn)) {
      console.log('[Moodle AI] Gemini: send button ready after image upload');
      return;
    }
    console.log('[Moodle AI] Gemini: send button not ready yet');
    await sleep(500);
  }
}

async function pasteImagesIntoPrompt(images) {
  const input = getPromptInput() || await waitForElement([
    '.ql-editor[contenteditable="true"]',
    'rich-textarea [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]'
  ], 25000);

  input.focus();
  await sleep(500);

  const dt = new DataTransfer();
  images.forEach(image => dt.items.add(imageToFile(image)));

  input.dispatchEvent(new ClipboardEvent('paste', {
    clipboardData: dt,
    bubbles: true,
    cancelable: true,
    composed: true
  }));
}

async function attachImagesViaFileInput(images) {
  const input = await waitForElement([
    'input[type="file"][accept*="image"]',
    'input[type="file"]'
  ], 15000);

  const dt = new DataTransfer();
  images.forEach(image => dt.items.add(imageToFile(image)));
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function attachImages(images) {
  if (!images?.length) return;

  const before = countComposerImages();
  console.log('[Moodle AI] Gemini: attaching images =', images.length, 'composer images before =', before);

  try {
    await pasteImagesIntoPrompt(images);
    if (await waitForComposerImages(before, images.length, 20000)) {
      console.log('[Moodle AI] Gemini: images attached via paste');
      return;
    }
  } catch (e) {
    console.warn('[Moodle AI] Gemini: paste attach failed:', e.message);
  }

  try {
    await attachImagesViaFileInput(images);
    if (await waitForComposerImages(before, images.length, 20000)) {
      console.log('[Moodle AI] Gemini: images attached via file input');
      return;
    }
  } catch (e) {
    console.warn('[Moodle AI] Gemini: file input attach failed:', e.message);
  }

  throw new Error(
    'Gemini Webに画像を添付できませんでした。テキストだけ送ると誤答しやすいため停止しました。' +
    'APIモードを使うか、Geminiの画面仕様変更に合わせた添付処理の更新が必要です。'
  );
}

// ── Get text of the LAST response element ─────────────────────────────────
function getLastResponseText() {
  const SELS = [
    'model-response',
    '.model-response-text',
    'response-container',
    '.response-content',
    'message-content',
    '[class*="model-response"]',
    '[class*="response-container"]',
    '.conversation-container .response',
    '.chat-history model-response',
    'ms-chat-turn model-response',
    '[data-content-component]',
    '[class*="response"][class*="text"]',
    '[class*="markdown"]',
    '.formatted-response'
  ];

  for (const sel of SELS) {
    let els;
    try { els = document.querySelectorAll(sel); } catch (_) { continue; }
    if (!els.length) continue;
    const text = els[els.length - 1]?.innerText?.trim();
    if (text && text.length > 5) {
      return text;
    }
  }
  return '';
}

// ── Type prompt into Gemini's editor ────────────────────────────────────────
async function typePrompt(prompt) {
  const input = await waitForElement([
    '.ql-editor[contenteditable="true"]',
    'rich-textarea [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]'
  ], 25000);

  console.log('[Moodle AI] Gemini: input found:', input.tagName, input.className.slice(0, 60));

  input.focus();
  await sleep(600);

  // Method 1: clipboard paste — Quill handles this best
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', prompt);
    input.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true
    }));
    await sleep(1000);
    const text = (input.innerText ?? input.textContent ?? '').trim();
    if (text.length > 0) {
      console.log('[Moodle AI] Gemini: paste succeeded, len =', text.length);
      return;
    }
  } catch (e) {
    console.warn('[Moodle AI] Gemini: paste threw:', e.message);
  }

  // Method 2: execCommand with explicit cursor placement
  try {
    input.focus();
    input.innerHTML = '';
    // Place cursor at beginning of the (now empty) element
    const range = document.createRange();
    range.setStart(input, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('insertText', false, prompt);
    await sleep(500);
    const text = (input.innerText ?? input.textContent ?? '').trim();
    if (text.length > 0) {
      console.log('[Moodle AI] Gemini: execCommand succeeded, ok=', ok, ', len=', text.length);
      return;
    }
  } catch (e) {
    console.warn('[Moodle AI] Gemini: execCommand threw:', e.message);
  }

  // Method 3: innerHTML + InputEvent
  const safe = prompt
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split('\n')
    .map(l => `<p>${l || '<br>'}</p>`)
    .join('');
  input.innerHTML = safe;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(500);
  console.log('[Moodle AI] Gemini: innerHTML fallback, len =', (input.innerText ?? '').trim().length);
}

// ── Click the send button ────────────────────────────────────────────────────
async function clickSend(timeout = 10000) {
  await sleep(400);
  const deadline = Date.now() + timeout;
  let btn = null;

  while (Date.now() < deadline) {
    btn = getSendButton();
    if (isSendButtonReady(btn)) break;
    await sleep(500);
  }

  if (!isSendButtonReady(btn)) {
    throw new Error('Gemini: 送信ボタンが有効になりませんでした。画像アップロードがまだ終わっていない可能性があります。');
  }

  console.log('[Moodle AI] Gemini: send button candidate:', btn.tagName, btn.getAttribute('aria-label') || '', btn.className?.toString?.() || '');
  await clickElementLikeUser(btn);
  await sleep(900);

  const stillReady = isSendButtonReady(getSendButton());
  if (stillReady) {
    console.warn('[Moodle AI] Gemini: click did not appear to submit, trying Enter fallback');
    await pressEnterToSend();
  }

  console.log('[Moodle AI] Gemini: send attempted');
}

async function clickElementLikeUser(el) {
  el.scrollIntoView({ block: 'center', inline: 'center' });
  await sleep(100);

  const rect = el.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  };

  ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
    const EventClass = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new EventClass(type, init));
  });
  el.click();
}

async function pressEnterToSend() {
  const input = getPromptInput();
  if (!input) return;

  input.focus();
  await sleep(100);
  ['keydown', 'keypress', 'keyup'].forEach(type => {
    input.dispatchEvent(new KeyboardEvent(type, {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
      composed: true
    }));
  });
}

// ── Wait for Gemini to finish generating ────────────────────────────────────
async function waitForResponse() {
  // Capture text visible BEFORE the new response arrives
  const baseline = getLastResponseText();
  console.log('[Moodle AI] Gemini: baseline len =', baseline.length);

  // Give Gemini time to start streaming
  await sleep(3000);

  // Phase 1: wait for new text (different from baseline, length > 30)
  console.log('[Moodle AI] Gemini: waiting for new response text…');
  const phase1Deadline = Date.now() + 45_000;

  while (Date.now() < phase1Deadline) {
    const current = getLastResponseText();
    if (current && current !== baseline && current.length > 30) break;
    await sleep(600);
  }

  const firstText = getLastResponseText();
  if (!firstText || firstText === baseline) {
    throw new Error(
      'Gemini: 45秒待っても新しい回答テキストが見つかりませんでした。\n' +
      'F12 → Console でデバッグ情報を確認してください。'
    );
  }
  console.log('[Moodle AI] Gemini: new response started, len =', firstText.length);

  // Phase 2: stability detection
  // Require text to be unchanged for STABLE_MS ms.
  // Also uses stop-button lifecycle: if stop button appeared then disappeared → done.
  const STABLE_MS  = 8000;
  const CHECK_MS   = 500;
  const STABLE_NEED = Math.ceil(STABLE_MS / CHECK_MS); // 16 checks

  const STOP_SELS = [
    'button[aria-label*="stop" i]',
    'button[aria-label*="停止" i]',
    'button[aria-label*="Stop"]',
    'button[data-mat-icon-name="stop"]'
  ].join(', ');

  const deadline = Date.now() + 180_000;
  let lastText    = '';
  let stableCount = 0;
  let stopBtnSeen = false;

  while (Date.now() < deadline) {
    const current = getLastResponseText();
    const stopBtn = (() => { try { return document.querySelector(STOP_SELS); } catch (_) { return null; } })();

    if (stopBtn) stopBtnSeen = true;

    // Only count stability for text that is actually new (≠ baseline)
    if (current && current !== baseline && current === lastText) {
      stableCount++;
      console.log(`[Moodle AI] Gemini: stable ${stableCount}/${STABLE_NEED}, stopSeen=${stopBtnSeen}, stopNow=${!!stopBtn}, len=${current.length}`);

      // Stop button appeared then disappeared → generation finished
      if (stopBtnSeen && !stopBtn && stableCount >= 3) {
        console.log('[Moodle AI] Gemini: stop-button gone → done');
        break;
      }
      if (stableCount >= STABLE_NEED) {
        console.log('[Moodle AI] Gemini: stability threshold reached');
        break;
      }
    } else {
      if (current && current !== baseline) lastText = current;
      stableCount = 0;
    }

    await sleep(CHECK_MS);
  }

  if (!lastText) throw new Error('Gemini: 回答が取得できませんでした（タイムアウト）');
  console.log('[Moodle AI] Gemini: final response len =', lastText.length);
  return lastText;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const response = await new Promise(resolve =>
    chrome.runtime.sendMessage({ action: 'webAIReady' }, resolve)
  );

  if (!response?.prompt) return;

  const expectedImages = response.images?.length ?? 0;
  const promptImageRefs = getImageCountFromPrompt(response.prompt);
  console.log('[Moodle AI] Gemini: prompt received, len =', response.prompt.length, 'images =', expectedImages, 'refs =', promptImageRefs);

  try {
    if (promptImageRefs > 0 && expectedImages === 0) {
      throw new Error(
        '問題文には画像参照がありますが、Gemini Webへ渡す画像データがありません。' +
        'Moodleページを再読み込みしてから再試行してください。'
      );
    }

    await typePrompt(response.prompt);
    await attachImages(response.images ?? []);
    await waitForUploadsToSettle(expectedImages);
    await clickSend(expectedImages > 0 ? 60000 : 10000);
    const text = await waitForResponse();
    chrome.runtime.sendMessage({ action: 'webAIDone', text });
  } catch (e) {
    console.error('[Moodle AI] Gemini error:', e);
    chrome.runtime.sendMessage({ action: 'webAIError', error: e.message });
  }
}

main();
