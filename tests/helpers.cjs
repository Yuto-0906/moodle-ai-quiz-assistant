const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

function loadScript(file, html, exports) {
  const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; }
  });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const hidden = this.closest('[hidden], [aria-hidden="true"], [style*="display: none"]');
    return { width: hidden ? 0 : 100, height: hidden ? 0 : 40 };
  };
  // Keep startup out of the harness，but execute the production functions.
  // No test hooks or globals are shipped in the extension itself.
  const source = readFileSync(join(__dirname, '..', file), 'utf8');
  const expose = `window.testAPI = { ${exports.join(', ')} };`;
  const instrumented = file === 'content.js'
    ? source.replace('  createUI();', expose)
    : source.replace(/\nmain\(\);\s*$/, '\n' + expose);
  if (source === instrumented) throw new Error(`Startup hook not found: ${file}`);
  window.eval(instrumented);
  return { dom, window, document: window.document, api: window.testAPI };
}

function fakeClock(window, onTick = () => {}) {
  let now = 0;
  window.Date.now = () => now;
  window.setTimeout = (callback, delay) => setImmediate(() => {
    now += delay;
    onTick(now);
    callback();
  });
  return () => now;
}

const plain = value => JSON.parse(JSON.stringify(value));
module.exports = { loadScript, fakeClock, plain };
