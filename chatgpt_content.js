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
  const selectors = [
    '[data-composer-markdown][contenteditable="true"]',
    '#prompt-textarea',
    '[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][data-gramm]'
  ];
  for (const selector of selectors) {
    const input = Array.from(document.querySelectorAll(selector)).find(isVisible);
    if (input) return input;
  }
  return null;
}

function isVisible(el) {
  if (!el || !el.isConnected || el.closest('[hidden], [aria-hidden="true"]')) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function getComposerRoot() {
  const input = getPromptInput();
  return input?.closest('form, [data-composer-body], [data-testid="composer"]') || input?.parentElement;
}

async function waitForPromptInput(timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const input = getPromptInput();
    if (input) return input;
    await sleep(300);
  }
  throw new Error('ChatGPT: 入力欄が見つかりませんでした。');
}

function countComposerImages() {
  const root = getComposerRoot();
  if (!root) return 0;
  // Count each thumbnail once. Looking across the page also counts history
  // images and multiple nested elements belonging to the same attachment.
  return Array.from(root.querySelectorAll('img')).filter(img =>
    isVisible(img) && !img.closest('button')
  ).length;
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
  const root = getComposerRoot();
  if (!root) return null;
  const selectors = [
    'button[data-testid="send-button"]',
    'button[aria-label="送信"]',
    'button[aria-label="Send"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="メッセージを送信"]',
    'button[aria-label="プロンプトを送信"]',
    'button[aria-label="Send message"]'
  ];

  for (const sel of selectors) {
    try {
      const btn = Array.from(root.querySelectorAll(sel)).find(isVisible);
      if (btn) return btn;
    } catch (_) {}
  }
  // The current composer uses a submit button without a data-testid.
  return Array.from(root.querySelectorAll('button[type="submit"]')).find(btn =>
    isVisible(btn) && !/stop|停止|cancel|キャンセル|音声|voice/i.test(btn.getAttribute('aria-label') || '')
  ) || null;
}

function isSendButtonReady(btn) {
  if (!isVisible(btn)) return false;
  const ariaDisabled = btn.getAttribute('aria-disabled') === 'true';
  return !btn.disabled && !ariaDisabled && btn.getAttribute('aria-busy') !== 'true';
}

async function waitForUploadsToSettle(imageCount) {
  if (!imageCount) return;

  const deadline = Date.now() + 60000;
  let readySince = null;
  while (Date.now() < deadline) {
    const btn = getSendButton();
    const uploading = getComposerRoot()?.querySelector(
      '[role="progressbar"], [aria-busy="true"], [data-state="uploading"]'
    );
    if (countComposerImages() >= imageCount && isSendButtonReady(btn) && !uploading) {
      readySince ??= Date.now();
      if (Date.now() - readySince >= 1000) return;
    } else {
      readySince = null;
    }
    await sleep(500);
  }
  throw new Error('ChatGPT: 画像のアップロードが完了しませんでした。添付画像とエラー表示を確認してください。');
}

async function pasteImageIntoPrompt(image) {
  const input = getPromptInput() || await waitForPromptInput();

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
 * Insert the prompt through the editor's input path and verify its full text.
 * Support both the current ProseMirror composer and legacy textarea inputs.
 */
async function typePrompt(prompt) {
  const input = await waitForPromptInput();

  input.focus();
  await sleep(300);

  if (input.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, prompt);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
  } else {
    // Limit selection to this editor. selectAll can select the entire page
    // when the composer was replaced during a React render.
    const range = document.createRange();
    range.selectNodeContents(input);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand('insertText', false, prompt)) {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', prompt);
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }
  }
  await sleep(400);

  const current = getPromptInput();
  const actual = current?.tagName === 'TEXTAREA' ? current.value : current?.innerText;
  const normalize = text => String(text ?? '').replace(/\s+/g, ' ').trim();
  if (normalize(actual) !== normalize(prompt)) {
    throw new Error('ChatGPT: 問題文を入力欄に正しく挿入できませんでした。ページを再読み込みして再試行してください。');
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

  const previousMessages = captureAssistantMessages();
  btn.click();
  return previousMessages;
}

function getStopButton() {
  return Array.from(document.querySelectorAll(
    'button[data-testid="stop-button"], button[aria-label="Stop generating"], ' +
    'button[aria-label="Stop response"], button[aria-label="生成を停止"], ' +
    'button[aria-label="応答を停止"], button[aria-label="回答を停止"], button[aria-label="停止"]'
  )).find(isVisible) || null;
}

function getAssistantMessages() {
  const selectors = '[data-markdown-text-style="assistant-message"], ' +
    '[data-message-author-role="assistant"], [data-message-author="assistant"], ' +
    '[data-testid="assistant-message"], [data-turn="assistant"]';
  return Array.from(document.querySelectorAll(
    selectors
  )).filter(el => !el.parentElement?.closest(selectors));
}

function getMessageKey(el) {
  return el.getAttribute('data-message-id')
    || el.closest('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id')
    || el;
}

function captureAssistantMessages() {
  return new Set(getAssistantMessages().map(getMessageKey));
}

/**
 * Wait for a new assistant message to stop streaming and remain stable.
 * The pre-send message snapshot prevents returning an older conversation turn.
 */
async function waitForResponse(previousMessages, timeout = 180000) {
  const deadline = Date.now() + timeout;
  let lastText = '';
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const messages = getAssistantMessages().filter(el =>
      !previousMessages.has(getMessageKey(el))
    );
    const latest = messages[messages.length - 1];
    const text = latest?.innerText?.trim() || '';
    if (text !== lastText) {
      lastText = text;
      stableSince = Date.now();
    }
    const streaming = latest?.closest('[data-is-streaming="true"]')
      || latest?.querySelector('[data-is-streaming="true"]');
    if (text && !getStopButton() && !streaming && Date.now() - stableSince >= 1800) return text;
    await sleep(600);
  }
  throw new Error('ChatGPT: 新しい回答の完了を確認できませんでした。送信状態・通信エラー・利用上限を確認してください。');
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
    const previousMessages = await clickSend(expectedImages > 0 ? 45000 : 8000);
    const text = await waitForResponse(previousMessages);
    chrome.runtime.sendMessage({ action: 'webAIDone', text });
  } catch (e) {
    chrome.runtime.sendMessage({ action: 'webAIError', error: e.message });
  }
}

main();
