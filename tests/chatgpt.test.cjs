const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript, fakeClock } = require('./helpers.cjs');

function chat(html = '', editor = '<div contenteditable="true" data-composer-markdown role="textbox"><p></p></div>') {
  return loadScript('chatgpt_content.js', `<div data-composer-body>${editor}${html}</div>`, [
    'getPromptInput', 'getSendButton', 'isSendButtonReady', 'countComposerImages', 'typePrompt',
    'clickSend', 'captureAssistantMessages', 'waitForResponse', 'waitForUploadsToSettle'
  ]);
}

test('the current Japanese send button is located inside the current composer', () => {
  const { document, api } = chat('<button type="submit" aria-label="送信" id="send"></button>');
  document.body.insertAdjacentHTML('afterbegin', '<button aria-label="送信" id="unrelated"></button>');
  assert.equal(api.getSendButton().id, 'send');
  assert.equal(api.isSendButtonReady(api.getSendButton()), true);
  assert.ok(api.getPromptInput().hasAttribute('data-composer-markdown'));
});

test('legacy input and send-button selectors remain supported', () => {
  const { api } = chat('<button data-testid="send-button" id="legacy"></button>',
    '<div id="prompt-textarea" contenteditable="true"></div>');
  assert.equal(api.getPromptInput().id, 'prompt-textarea');
  assert.equal(api.getSendButton().id, 'legacy');
});

test('hidden stale composers and disabled or busy buttons are ignored', () => {
  const { document, api } = chat('<button aria-label="送信" id="send" aria-disabled="true"></button>');
  document.body.insertAdjacentHTML('afterbegin', '<div hidden data-composer-body><div contenteditable="true" data-composer-markdown></div><button aria-label="送信"></button></div>');
  const btn = document.getElementById('send');
  assert.equal(api.isSendButtonReady(api.getSendButton()), false);
  btn.removeAttribute('aria-disabled');
  btn.setAttribute('aria-busy', 'true');
  assert.equal(api.isSendButtonReady(btn), false);
  btn.removeAttribute('aria-busy');
  btn.disabled = true;
  assert.equal(api.isSendButtonReady(btn), false);
});

test('a composer submit button works as fallback，but voice and stop buttons do not', () => {
  const { document, api } = chat('<button type="submit" aria-label="停止" id="stop"></button><button type="submit" id="fallback"></button>');
  assert.equal(api.getSendButton().id, 'fallback');
  document.getElementById('fallback').remove();
  assert.equal(api.getSendButton(), null);
});

test('attachments are counted once and conversation-history images are excluded', () => {
  const { document, api } = chat('<div data-testid="attachment" class="attachment"><img src="data:image/png;base64,YQ=="></div><button><img alt="toolbar icon"></button>');
  document.body.insertAdjacentHTML('beforeend', '<div data-message-author-role="assistant"><img src="blob:history"></div>');
  assert.equal(api.countComposerImages(), 1);
});

test('prompt insertion selects only the editor and verifies the actual text', async () => {
  const { window, document, api } = chat();
  fakeClock(window);
  document.execCommand = (command, _ui, text) => {
    assert.equal(command, 'insertText');
    assert.equal(window.getSelection().getRangeAt(0).commonAncestorContainer, api.getPromptInput());
    api.getPromptInput().textContent = text;
    return true;
  };
  await api.typePrompt('問題データ\n{"questions": []}');
  assert.equal(api.getPromptInput().textContent, '問題データ\n{"questions": []}');
});

test('failed prompt insertion reports an error instead of changing textContent behind React', async () => {
  const { window, document, api } = chat();
  fakeClock(window);
  document.execCommand = () => true;
  await assert.rejects(api.typePrompt('問題文'), /正しく挿入できません/);
});

test('legacy textarea insertion uses its native value and input event', async () => {
  const { window, api } = chat('', '<textarea id="prompt-textarea"></textarea>');
  fakeClock(window);
  let events = 0;
  api.getPromptInput().addEventListener('input', () => events++);
  await api.typePrompt('テスト');
  assert.equal(api.getPromptInput().value, 'テスト');
  assert.equal(events, 1);
});

test('clickSend waits for readiness and records only the messages predating submission', async () => {
  const { window, document, api } = chat('<button type="submit" aria-label="送信" id="send" disabled></button>');
  document.body.insertAdjacentHTML('beforeend', '<div data-message-author-role="assistant" data-message-id="old">古い回答</div>');
  let clicks = 0;
  const button = document.getElementById('send');
  button.addEventListener('click', () => {
    clicks++;
    document.body.insertAdjacentHTML('beforeend', '<div data-message-author-role="assistant" data-message-id="new">新しい回答</div>');
  });
  fakeClock(window, now => { if (now >= 500) button.disabled = false; });
  const previous = await api.clickSend(3000);
  assert.equal(clicks, 1);
  assert.equal(previous.has('old'), true);
  assert.equal(previous.has('new'), false);
  assert.equal(await api.waitForResponse(previous, 5000), '新しい回答');
});

test('an old answer is never mistaken for a response to the current request', async () => {
  const { window, document, api } = chat();
  document.body.insertAdjacentHTML('beforeend', '<div data-message-author-role="assistant" data-message-id="old">以前の回答</div>');
  fakeClock(window);
  await assert.rejects(api.waitForResponse(api.captureAssistantMessages(), 3000), /完了を確認できません/);
});

test('current markdown messages are tracked by their stable message id across React renders', async () => {
  const { window, document, api } = chat();
  document.body.insertAdjacentHTML('beforeend', '<div data-chatgpt-selection-message-id="old" id="old"><div data-markdown-text-style="assistant-message">以前の回答</div></div>');
  const previous = api.captureAssistantMessages();
  assert.equal(previous.has('old'), true);
  document.getElementById('old').innerHTML = '<div data-markdown-text-style="assistant-message">以前の回答</div>';
  fakeClock(window);
  await assert.rejects(api.waitForResponse(previous, 3000), /完了を確認できません/);
  document.body.insertAdjacentHTML('beforeend', '<div data-chatgpt-selection-message-id="new"><div data-markdown-text-style="assistant-message">{"ok":true}</div></div>');
  assert.equal(await api.waitForResponse(previous, 5000), '{"ok":true}');
});

test('response completion waits for the current Japanese stop button and streaming state', async () => {
  const { window, document, api } = chat();
  const previous = api.captureAssistantMessages();
  document.body.insertAdjacentHTML('beforeend', '<button aria-label="停止" id="stop"></button><div data-message-author-role="assistant" data-message-id="new" data-is-streaming="true">途中</div>');
  const elapsed = fakeClock(window, now => {
    if (now >= 2400) {
      document.getElementById('stop')?.remove();
      const message = document.querySelector('[data-message-id="new"]');
      message.removeAttribute('data-is-streaming');
      message.textContent = '{"questions":[]}';
    }
  });
  assert.equal(await api.waitForResponse(previous, 7000), '{"questions":[]}');
  assert.ok(elapsed() >= 4200);
});

test('a timed-out generation fails instead of returning an incomplete answer', async () => {
  const { window, document, api } = chat();
  const previous = api.captureAssistantMessages();
  document.body.insertAdjacentHTML('beforeend', '<button aria-label="停止"></button><div data-message-author-role="assistant" data-message-id="new">{"questions":</div>');
  fakeClock(window);
  await assert.rejects(api.waitForResponse(previous, 3000), /完了を確認できません/);
});

test('image upload waits for progress to finish even when the send button is enabled', async () => {
  const { window, document, api } = chat('<img src="blob:upload"><div role="progressbar" id="progress"></div><button aria-label="送信"></button>');
  const elapsed = fakeClock(window, now => { if (now >= 2000) document.getElementById('progress')?.remove(); });
  await api.waitForUploadsToSettle(1);
  assert.ok(elapsed() >= 3000);
});
