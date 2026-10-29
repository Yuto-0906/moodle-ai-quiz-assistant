const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

function background() {
  let receive;
  const replies = [];
  const closed = [];
  const timers = [];
  const chrome = {
    runtime: { onMessage: { addListener(listener) { receive = listener; } } },
    tabs: {
      create(_options, callback) { callback({ id: 55 }); },
      remove(tabId) { closed.push(tabId); return Promise.resolve(); },
      onRemoved: { addListener() {} }
    }
  };
  runInNewContext(readFileSync(join(__dirname, '..', 'background.js'), 'utf8'), {
    chrome, setTimeout(callback) { timers.push(callback); }
  });
  receive({ action: 'askWebAI', provider: 'chatgpt', prompt: 'test' }, { tab: { id: 1 } }, reply => replies.push(reply));
  return { replies, closed, timers, send(message) { receive(message, { tab: { id: 55 } }, () => {}); } };
}

test('a successful nonempty response still closes the temporary AI tab', () => {
  const state = background();
  state.send({ action: 'webAIDone', text: '{"questions":[]}' });
  assert.equal(state.replies[0].success, true);
  state.timers.forEach(callback => callback());
  assert.deepEqual(state.closed, [55]);
});

test('an empty done message is rejected and the AI tab remains available', () => {
  const state = background();
  state.send({ action: 'webAIDone', text: ' \n ' });
  assert.equal(state.replies[0].success, false);
  assert.match(state.replies[0].error, /空白/);
  assert.equal(state.timers.length, 0);
  assert.deepEqual(state.closed, []);
  state.send({ action: 'webAIDone', text: 'late response' });
  assert.equal(state.replies.length, 1);
});

test('an AI error keeps the conversation open for manual inspection', () => {
  const state = background();
  state.send({ action: 'webAIError', error: '再掲後も空白' });
  assert.equal(state.replies[0].success, false);
  assert.equal(state.replies[0].error, '再掲後も空白');
  assert.deepEqual(state.closed, []);
});
