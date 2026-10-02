const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript, plain } = require('./helpers.cjs');

function moodle(html) {
  return loadScript('content.js', `<form id="responseform">${html}</form>`, [
    'extractInfo', 'buildPrompt', 'readContent', 'collectQuestionImages', 'applyAnswer'
  ]);
}

function question(slot, body, type = 'multichoice') {
  return `<div class="que ${type}" id="question-123-${slot}">${body}</div>`;
}

function choice(slot, value, text, legacy = false) {
  const id = `q123:${slot}_answer${value}`;
  return `<div class="r0"><input type="radio" name="q123:${slot}_answer" value="${value}" id="${id}"
    ${legacy ? '' : `aria-labelledby="${id}_label"`}>
    ${legacy ? `<label for="${id}">${text}</label>` : `<div id="${id}_label" data-region="answer-label">${text}</div>`}</div>`;
}

test('current aria-labelledby choices retain their text and exclude the clear-choice radio', () => {
  const { document, api } = moodle(question(2, `<div class="qtext">空欄を選べ。</div>
    ${choice(2, 0, 'a. 156')}${choice(2, 1, 'b. 158')}
    <div class="qtype_multichoice_clearchoice" aria-hidden="true">
      <input type="radio" name="q123:2_answer" value="-1" id="q123:2_answer-1">
      <label for="q123:2_answer-1">私の選択をクリアする</label></div>`));
  assert.deepEqual(plain(api.extractInfo(document.querySelector('.que')).choices), [
    { value: '0', text: 'a. 156' }, { value: '1', text: 'b. 158' }
  ]);
});

test('legacy labels remain supported', () => {
  const { document, api } = moodle(question(2, choice(2, 0, '旧形式の選択肢', true)));
  assert.equal(api.extractInfo(document.querySelector('.que')).choices[0].text, '旧形式の選択肢');
});

test('checkbox choices use their field index and new label text', () => {
  const { document, api } = moodle(question(3, `<div class="qtext">全て選べ。</div>
    <input type="checkbox" name="q123:3_choice2" value="1" id="c2" aria-labelledby="c2_label">
    <div id="c2_label">選択肢C</div>`));
  const info = api.extractInfo(document.querySelector('.que'));
  assert.equal(info.isMulti, true);
  assert.deepEqual(plain(info.choices), [{ index: 2, text: '選択肢C' }]);
  api.applyAnswer(document.querySelector('.que'), { answers: [2] });
  assert.equal(document.getElementById('c2').checked, true);
});

test('shared descriptions，MathJax matrices and table cells survive JSON extraction', () => {
  const math = `<mjx-container><mjx-math aria-hidden="true"></mjx-math><mjx-assistive-mml>
    <math><mrow><mo>[</mo><mtable><mtr><mtd><mn>10</mn></mtd><mtd><mn>20</mn></mtd></mtr>
    <mtr><mtd><mn>30</mn></mtd><mtd><mn>40</mn></mtd></mtr></mtable><mo>]</mo></mrow></math>
    </mjx-assistive-mml></mjx-container>`;
  const { document, api } = moodle(
    question(1, `<div class="qtext">共通説明${math}<table><tr><th>縦</th><th>横</th></tr>
      <tr><td>1</td><td>2</td></tr></table></div>`, 'description')
    + question(2, `<div class="qtext">(a)を選べ。</div>${choice(2, 0, '20')}`)
    + question(3, `<div class="qtext">(b)を選べ。</div>${choice(3, 0, '40')}`)
    + question(5, '<div class="qtext">次の共通説明</div>', 'description')
    + question(6, `<div class="qtext">次の空欄。</div>${choice(6, 0, '8')}`)
  );
  const infos = Array.from(document.querySelectorAll('.que'), api.extractInfo);
  assert.match(infos[0].questionText, /matrix\(10, 20; 30, 40\)/);
  assert.match(infos[0].questionText, /縦 \| 横\n1 \| 2/);
  const prompt = api.buildPrompt(infos);
  const data = JSON.parse(prompt.split('【問題データ（JSON）】\n')[1]);
  assert.deepEqual(data.contexts.map(c => c.slot), [1, 5]);
  assert.deepEqual(data.questions.map(q => q.contextSlots), [[1], [1], [5]]);
  assert.equal(data.questions.length, 3);
  const template = JSON.parse(prompt.slice(prompt.indexOf('{'), prompt.indexOf('【問題データ（JSON）】')).trim());
  assert.deepEqual(template.questions.map(q => q.slot), [2, 3, 6]);
  assert.ok(!prompt.includes('usageid'));
});

test('MathML fractions，powers and roots keep their mathematical structure', () => {
  const { document, api } = moodle(question(1, `<div class="qtext"><math><mfrac><mn>1</mn>
    <msup><mi>x</mi><mn>2</mn></msup></mfrac><mo>+</mo><msqrt><mi>y</mi></msqrt></math></div>`));
  assert.equal(api.extractInfo(document.querySelector('.que')).questionText, '(1)/(x^{2})+sqrt(y)');
});

test('each choice image carries its choice value instead of relying on DOM order', async () => {
  const { document, api } = moodle(question(4,
    choice(4, 2, '<img src="data:image/png;base64,YWJj" alt="図C">')
    + choice(4, 0, '<img src="data:image/png;base64,ZGVm" alt="図A">')));
  const images = await api.collectQuestionImages(document.querySelector('.que'), 4);
  assert.deepEqual(plain(images.map(i => ({ index: i.index, choiceValue: i.choiceValue }))), [
    { index: 1, choiceValue: '2' }, { index: 2, choiceValue: '0' }
  ]);
});

test('prompt image metadata maps contact-sheet panels without embedding binary image data', () => {
  const { api } = moodle('');
  const prompt = api.buildPrompt([{ slot: 4, type: 'multichoice', isMulti: false, choices: [], images: [{
    index: 1, mimeType: 'image/png', width: 580, height: 300, alt: '選択肢の図',
    base64: 'DO_NOT_EMBED', src: 'https://private.test/image',
    combinedFrom: [{ index: 1, choiceValue: '2', width: 200, height: 200 }]
  }] }]);
  const data = JSON.parse(prompt.split('【問題データ（JSON）】\n')[1]);
  assert.equal(data.questions[0].images[0].ref, '[slot:4 image:1]');
  assert.equal(data.questions[0].images[0].fileName, 'moodle-slot-4-image-1.png');
  assert.equal(data.questions[0].images[0].panels[0].choiceValue, '2');
  assert.ok(!prompt.includes('DO_NOT_EMBED'));
  assert.ok(!prompt.includes('private.test'));
});

test('new choice markup still accepts the returned value', () => {
  const { document, api } = moodle(question(2, choice(2, 0, '156') + choice(2, 1, '158')));
  api.applyAnswer(document.querySelector('.que'), { answer: '1' });
  assert.equal(document.getElementById('q123:2_answer1').checked, true);
  assert.equal(document.getElementById('q123:2_answer0').checked, false);
});
