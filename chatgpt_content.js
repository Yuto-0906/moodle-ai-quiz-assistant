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

/**
 * Poll until one of the given CSS selectors matches an element, or timeout.
 */
async function waitForElement(selectors, timeout = 20000) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    await sleep(300);
  }
  throw new Error(`ChatGPT: 要素が見つかりませんでした → ${list.join(' / ')}`);
}

function getPromptInput() {
  return document.querySelector('#prompt-textarea') ||
    document.querySelector('div[contenteditable="true"][data-gramm]') ||
    document.querySelector('div[contenteditable="true"]');
}

function countComposerImages() {
  const selectors = [
    '[data-testid*="attachment"]',
    '[data-testid*="file"]',
    '[class*="attachment"]',
    '[class*="FilePreview"]',
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
    if (count >= previousCount + expectedCount) return true;
    await sleep(500);
  }
  return false;
}

function getSendButton() {
  const selectors = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="メッセージを送信"]',
    'button[aria-label="Send message"]'
  ];

  for (const sel of selectors) {
    try {
      const btn = document.querySelector(sel);
      if (btn) return btn.closest('button') ?? btn;
    } catch (_) {}
  }
  return null;
}

function isSendButtonReady(btn) {
  if (!btn) return false;
  const ariaDisabled = btn.getAttribute('aria-disabled') === 'true';
  return !btn.disabled && !ariaDisabled;
}

async function waitForUploadsToSettle(imageCount) {
  if (!imageCount) return;

  const minWait = Math.min(10000 + imageCount * 2000, 25000);
  console.log('[Moodle AI] ChatGPT: waiting for image upload settle, ms =', minWait);
  await sleep(minWait);

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const btn = getSendButton();
    if (isSendButtonReady(btn)) {
      console.log('[Moodle AI] ChatGPT: send button ready after image upload');
      return;
    }
    console.log('[Moodle AI] ChatGPT: send button not ready yet');
    await sleep(1000);
  }
}

async function pasteImageIntoPrompt(image) {
  const input = getPromptInput() || await waitForElement([
    '#prompt-textarea',
    'div[contenteditable="true"][data-gramm]',
    'div[contenteditable="true"]'
  ], 25000);

  input.focus();
  await sleep(300);

  const dt = new DataTransfer();
  dt.items.add(imageToFile(image));

  input.dispatchEvent(new ClipboardEvent('paste', {
    clipboardData: dt,
    bubbles: true,
    cancelable: true,
    composed: true
  }));
}

async function attachImageViaFileInput(image) {
  const input = await waitForElement([
    'input[type="file"][accept*="image"]',
    'input[type="file"]'
  ], 15000);

  const dt = new DataTransfer();
  dt.items.add(imageToFile(image));
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function attachOneImage(image, targetCount) {
  try {
    await pasteImageIntoPrompt(image);
    if (await waitForComposerImages(0, targetCount, 15000)) {
      console.log(`[Moodle AI] ChatGPT: image ${image.index} attached via paste`);
      return true;
    }
  } catch (e) {
    console.warn(`[Moodle AI] ChatGPT: paste attach failed for image ${image.index}:`, e.message);
  }

  try {
    await attachImageViaFileInput(image);
    if (await waitForComposerImages(0, targetCount, 15000)) {
      console.log(`[Moodle AI] ChatGPT: image ${image.index} attached via file input`);
      return true;
    }
  } catch (e) {
    console.warn(`[Moodle AI] ChatGPT: file input attach failed for image ${image.index}:`, e.message);
  }

  return false;
}

async function attachImages(images) {
  if (!images?.length) return;

  const before = countComposerImages();
  console.log('[Moodle AI] ChatGPT: attaching images =', images.length, 'composer images before =', before);

  for (let i = 0; i < images.length; i++) {
    const targetCount = before + i + 1;
    const ok = await attachOneImage(images[i], targetCount);
    if (!ok) {
      break;
    }
    await sleep(1200);
  }

  const finalCount = countComposerImages();
  console.log('[Moodle AI] ChatGPT: composer images after attach =', finalCount);
  if (finalCount >= before + images.length) {
    return;
  }

  throw new Error(
    `ChatGPT Webに画像を${images.length}枚中${Math.max(0, finalCount - before)}枚しか添付できませんでした。テキストだけ送ると誤答しやすいため停止しました。` +
    'APIモードを使うか、ChatGPTの画面仕様変更に合わせた添付処理の更新が必要です。'
  );
}

/**
 * Type the prompt into ChatGPT's contenteditable input.
 * ChatGPT uses a ProseMirror-backed <div id="prompt-textarea" contenteditable>.
 */
async function typePrompt(prompt) {
  const input = await waitForElement([
    '#prompt-textarea',
    'div[contenteditable="true"][data-gramm]',
    'div[contenteditable="true"]'
  ], 25000);

  input.focus();
  await sleep(300);

  // Clear then insert via execCommand (works with React/ProseMirror)
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, prompt);
  await sleep(400);

  // Verify insertion; fallback to direct property manipulation
  if (!input.textContent.trim()) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLElement.prototype, 'textContent'
    ).set;
    nativeSetter.call(input, prompt);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await sleep(300);
  }
}

/**
 * Click the send button.
 */
async function clickSend(timeout = 8000) {
  const deadline = Date.now() + timeout;
  let btn = null;

  while (Date.now() < deadline) {
    btn = getSendButton();
    if (isSendButtonReady(btn)) break;
    await sleep(500);
  }

  if (!isSendButtonReady(btn)) {
    throw new Error('ChatGPT: 送信ボタンが有効になりませんでした。画像アップロードがまだ終わっていない可能性があります。');
  }

  btn.click();
}

/**
 * Wait until ChatGPT finishes streaming its response.
 * Strategy: wait for the stop-button to appear (generation started),
 * then wait for it to disappear (generation done).
 */
async function waitForResponse() {
  // 1. Wait for generation to start (stop button appears)
  await waitForElement([
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="生成を停止"]'
  ], 30000).catch(() => {
    // If stop button never appears, generation may have finished instantly
  });

  // 2. Wait for stop button to disappear (generation done)
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const stopBtn = document.querySelector(
      'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="生成を停止"]'
    );
    if (!stopBtn) break;
    await sleep(600);
  }

  await sleep(800); // Let DOM settle after streaming

  // 3. Extract last assistant message
  const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
  if (!msgs.length) throw new Error('ChatGPT: 回答メッセージが見つかりませんでした');
  return msgs[msgs.length - 1].innerText.trim();
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Ask background if there's a pending task for this tab
  const response = await new Promise(resolve =>
    chrome.runtime.sendMessage({ action: 'webAIReady' }, resolve)
  );

  if (!response?.prompt) return; // Normal browsing — do nothing

  try {
    const expectedImages = response.images?.length ?? 0;
    const promptImageRefs = getImageCountFromPrompt(response.prompt);
    console.log('[Moodle AI] ChatGPT: prompt received, len =', response.prompt.length, 'images =', expectedImages, 'refs =', promptImageRefs);

    if (promptImageRefs > 0 && expectedImages === 0) {
      throw new Error(
        '問題文には画像参照がありますが、ChatGPT Webへ渡す画像データがありません。' +
        'Moodleページを再読み込みしてから再試行してください。'
      );
    }

    await typePrompt(response.prompt);
    await attachImages(response.images ?? []);
    await waitForUploadsToSettle(expectedImages);
    await clickSend(expectedImages > 0 ? 45000 : 8000);
    const text = await waitForResponse();
    chrome.runtime.sendMessage({ action: 'webAIDone', text });
  } catch (e) {
    chrome.runtime.sendMessage({ action: 'webAIError', error: e.message });
  }
}

main();
