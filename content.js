(function () {
  'use strict';

  // Only run on active quiz attempt pages
  if (!document.querySelector('form#responseform')) return;

  // ============================================================
  // Helpers
  // ============================================================

  function fireEvents(el) {
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getIds(qDiv) {
    const m = qDiv.id.match(/^question-(\d+)-(\d+)$/);
    return m ? { usageid: m[1], slot: m[2] } : null;
  }

  const KNOWN_TYPES = [
    'shortanswer', 'match', 'multichoice', 'essay', 'truefalse',
    'numerical', 'calculated', 'calculatedsimple', 'calculatedmulti',
    'gapselect', 'ddwtos', 'ddimageortext', 'ddmarker', 'multianswer',
    'ordering', 'randomsamatch', 'regexp', 'pmatch', 'oumultiresponse', 'stack',
    'multichoiceset'
  ];

  function detectType(qDiv) {
    const known = Array.from(qDiv.classList).find(c => KNOWN_TYPES.includes(c));
    if (known) return known;

    const hasChoiceCheckbox =
      qDiv.querySelector('input[type="checkbox"][name*="_choice"]') ||
      qDiv.querySelector('input[type="checkbox"][name$="_answer[]"]') ||
      qDiv.querySelector('input[type="checkbox"][name$="_answer"]');
    if (hasChoiceCheckbox) return 'multichoice';

    const hasChoiceRadio = qDiv.querySelector('input[type="radio"][name$="_answer"]');
    if (hasChoiceRadio) return 'multichoice';

    return null;
  }

  function getChoiceIndexFromName(name) {
    const m = String(name ?? '').match(/_choice(\d+)(?:\D.*)?$/);
    if (!m) return null;
    const idx = parseInt(m[1], 10);
    return Number.isNaN(idx) ? null : idx;
  }

  function collectMultiChoiceCheckboxes(qDiv, usageid, slot) {
    const selectors = [
      `input[type="checkbox"][name^="q${usageid}:${slot}_choice"]`,
      `input[type="checkbox"][name="q${usageid}:${slot}_answer[]"]`,
      `input[type="checkbox"][name="q${usageid}:${slot}_answer"]`
    ];
    const boxes = [];
    const seen = new Set();
    selectors.forEach(sel => {
      qDiv.querySelectorAll(sel).forEach(cb => {
        if (seen.has(cb)) return;
        seen.add(cb);
        boxes.push(cb);
      });
    });
    return boxes;
  }

  function dataUrlToImagePart(dataUrl) {
    const m = String(dataUrl ?? '').match(/^data:([^;,]+);base64,(.+)$/);
    if (!m) return null;
    return { mimeType: m[1], base64: m[2] };
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error ?? new Error('画像の読み込みに失敗しました'));
      reader.readAsDataURL(blob);
    });
  }

  function isProbablyContentImage(img) {
    const src = img.currentSrc || img.src || img.getAttribute('src') || '';
    if (!src || src.startsWith('blob:')) return false;
    if (src.includes('/pix/') || src.includes('/theme/image.php')) return false;

    const rect = img.getBoundingClientRect();
    const width = img.naturalWidth || rect.width;
    const height = img.naturalHeight || rect.height;
    if (!width || !height) return false;

    return width >= 12 && height >= 12;
  }

  async function imageElementToDataUrl(img) {
    const rawSrc = img.currentSrc || img.src || img.getAttribute('src');
    if (!rawSrc) return null;

    const src = new URL(rawSrc, document.baseURI).href;
    if (src.startsWith('data:')) return src;

    const res = await fetch(src, {
      credentials: 'include',
      cache: 'force-cache'
    });
    if (!res.ok) throw new Error(`画像取得エラー ${res.status}`);

    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    return blobToDataUrl(blob);
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('画像のデコードに失敗しました'));
      image.src = dataUrl;
    });
  }

  async function createContactSheet(images, slot) {
    if (images.length <= 1) return images;

    const decoded = await Promise.all(images.map(async img => ({
      ...img,
      element: await loadImage(img.dataUrl)
    })));

    const cellWidth = 260;
    const labelHeight = 28;
    const padding = 16;
    const gap = 12;
    const cols = Math.min(2, decoded.length);
    const rows = Math.ceil(decoded.length / cols);
    const cellHeight = Math.max(...decoded.map(img => {
      const scale = Math.min(1, cellWidth / img.width);
      return Math.round(img.height * scale) + labelHeight;
    }));

    const canvas = document.createElement('canvas');
    canvas.width = padding * 2 + cols * cellWidth + (cols - 1) * gap;
    canvas.height = padding * 2 + rows * cellHeight + (rows - 1) * gap;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111111';
    ctx.font = '16px sans-serif';
    ctx.textBaseline = 'top';

    decoded.forEach((img, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = padding + col * (cellWidth + gap);
      const y = padding + row * (cellHeight + gap);
      const scale = Math.min(1, cellWidth / img.width);
      const drawWidth = Math.round(img.width * scale);
      const drawHeight = Math.round(img.height * scale);

      ctx.fillText(`image ${img.index}`, x, y);
      ctx.strokeStyle = '#d0d7de';
      ctx.strokeRect(x, y + labelHeight, cellWidth, cellHeight - labelHeight);
      ctx.drawImage(img.element, x, y + labelHeight, drawWidth, drawHeight);
    });

    const dataUrl = canvas.toDataURL('image/png');
    const part = dataUrlToImagePart(dataUrl);
    if (!part) return images;

    return [{
      slot,
      index: 1,
      alt: `slot ${slot} contact sheet of ${images.length} images`,
      src: '',
      width: canvas.width,
      height: canvas.height,
      mimeType: part.mimeType,
      base64: part.base64,
      dataUrl,
      combinedFrom: images.map(img => ({
        index: img.index,
        width: img.width,
        height: img.height,
        alt: img.alt
      }))
    }];
  }

  async function collectQuestionImages(qDiv, slot) {
    const candidates = Array.from(qDiv.querySelectorAll('img')).filter(isProbablyContentImage);
    const images = [];
    const seen = new Set();

    for (const img of candidates) {
      if (images.length >= 6) break;
      const src = img.currentSrc || img.src || img.getAttribute('src') || '';
      if (seen.has(src)) continue;
      seen.add(src);

      try {
        const dataUrl = await imageElementToDataUrl(img);
        const part = dataUrlToImagePart(dataUrl);
        if (!part) continue;

        images.push({
          slot,
          index: images.length + 1,
          alt: img.alt?.trim() || img.title?.trim() || '',
          src: new URL(src, document.baseURI).href,
          width: img.naturalWidth || Math.round(img.getBoundingClientRect().width),
          height: img.naturalHeight || Math.round(img.getBoundingClientRect().height),
          mimeType: part.mimeType,
          base64: part.base64,
          dataUrl
        });
      } catch (e) {
        console.warn('[Moodle AI] image skipped:', src, e);
      }
    }

    return images;
  }

  async function attachImages(infos, qDivs) {
    const bySlot = new Map(infos.map(info => [String(info.slot), info]));
    const allImages = [];

    for (const qDiv of qDivs) {
      const ids = getIds(qDiv);
      const info = ids ? bySlot.get(String(parseInt(ids.slot, 10))) : null;
      if (!info) continue;

      const images = await collectQuestionImages(qDiv, info.slot);
      if (images.length > 0) {
        const preparedImages = await createContactSheet(images, info.slot);
        info.images = preparedImages.map(({ dataUrl, ...meta }) => meta);
        allImages.push(...preparedImages);
      }
    }

    return allImages;
  }

  // ============================================================
  // Extract question metadata for prompt building
  // ============================================================

  function extractInfo(qDiv) {
    const ids = getIds(qDiv);
    if (!ids) return null;
    const { usageid, slot } = ids;
    const type = detectType(qDiv);
    if (!type) return null;

    const questionText = qDiv.querySelector('.qtext')?.innerText?.trim() ?? '';
    const info = { slot: parseInt(slot), type, questionText, usageid, slotStr: slot };

    if (['numerical', 'calculated', 'calculatedsimple'].includes(type)) {
      const unitEls = qDiv.querySelectorAll(`[name="q${usageid}:${slot}_unit"]`);
      if (unitEls.length > 0) {
        const first = unitEls[0];
        if (first.tagName === 'SELECT') {
          info.unitOptions = Array.from(first.options).map(o => o.value).filter(Boolean);
        } else if (first.type === 'radio') {
          info.unitOptions = Array.from(unitEls).map(r => r.value);
        } else {
          info.hasUnitInput = true;
        }
      }

    } else if (['multichoice', 'calculatedmulti', 'multichoiceset'].includes(type)) {
      const cbs = collectMultiChoiceCheckboxes(qDiv, usageid, slot);
      if (cbs.length > 0) {
        info.isMulti = true;
        info.choices = cbs.map((cb, i) => ({
          index: getChoiceIndexFromName(cb.name) ?? i,
          text: (qDiv.querySelector(`label[for="${cb.id}"]`)?.innerText ?? cb.name).trim()
        }));
      } else {
        const radios = qDiv.querySelectorAll(`input[type="radio"][name="q${usageid}:${slot}_answer"]`);
        info.isMulti = false;
        info.choices = Array.from(radios).map(r => ({
          value: r.value,
          text: (qDiv.querySelector(`label[for="${r.id}"]`)?.innerText ?? r.value).trim()
        }));
      }

    } else if (['match', 'randomsamatch'].includes(type)) {
      const optionSet = new Set();
      info.subQuestions = [];
      qDiv.querySelectorAll('tr').forEach((row, i) => {
        const textEl = row.querySelector('td.text, td:first-child');
        const sel = row.querySelector('select');
        if (!textEl || !sel) return;
        Array.from(sel.options)
          .filter(o => o.value !== '0' && o.value !== '')
          .forEach(o => optionSet.add(o.text.trim()));
        info.subQuestions.push({ index: i, text: textEl.innerText.trim() });
      });
      info.options = Array.from(optionSet);

    } else if (type === 'gapselect') {
      const selects = qDiv.querySelectorAll(`select[name^="q${usageid}:${slot}_p"]`);
      info.gaps = Array.from(selects).map(sel => ({
        place: parseInt(sel.name.match(/_p(\d+)$/)[1]),
        options: Array.from(sel.options).filter(o => o.value !== '0').map(o => o.text.trim())
      }));

    } else if (['ddwtos', 'ddimageortext'].includes(type)) {
      const hiddens = qDiv.querySelectorAll(`input[type="hidden"][name^="q${usageid}:${slot}_p"]`);
      info.places = Array.from(hiddens).map(inp => parseInt(inp.name.match(/_p(\d+)$/)[1]));
      const dragMap = {};
      qDiv.querySelectorAll('.draghome[data-choice]').forEach(el => {
        dragMap[el.dataset.choice] = el.textContent.trim();
      });
      info.dragItems = dragMap;

    } else if (type === 'ddmarker') {
      const hiddens = qDiv.querySelectorAll(`input[type="hidden"][name^="q${usageid}:${slot}_c"]`);
      info.choiceNums = Array.from(hiddens).map(inp => parseInt(inp.name.match(/_c(\d+)$/)[1]));
      const markerMap = {};
      qDiv.querySelectorAll('.marker[data-choice]').forEach(el => {
        markerMap[el.dataset.choice] = el.textContent.trim();
      });
      info.markerLabels = markerMap;

    } else if (type === 'multianswer') {
      const seen = new Set();
      info.subInputs = [];
      qDiv.querySelectorAll(`[name^="q${usageid}:${slot}_sub"]`).forEach(el => {
        const m = el.name.match(/_sub(\d+)_answer$/);
        if (!m || seen.has(m[1])) return;
        seen.add(m[1]);
        const sub = { index: m[1] };
        if (el.tagName === 'SELECT') {
          sub.subType = 'select';
          sub.options = Array.from(el.options)
            .filter(o => o.value !== '' && o.value !== '0')
            .map(o => ({ value: o.value, text: o.text.trim() }));
        } else if (el.type === 'radio') {
          sub.subType = 'radio';
          const radios = qDiv.querySelectorAll(`[name="q${usageid}:${slot}_sub${m[1]}_answer"]`);
          sub.options = Array.from(radios).map(r => ({
            value: r.value,
            text: (qDiv.querySelector(`label[for="${r.id}"]`)?.innerText ?? r.value).trim()
          }));
        } else {
          sub.subType = 'text';
        }
        info.subInputs.push(sub);
      });

    } else if (type === 'ordering') {
      info.items = Array.from(qDiv.querySelectorAll('li.sortableitem')).map(li => li.textContent.trim());

    } else if (type === 'oumultiresponse') {
      const cbs = collectMultiChoiceCheckboxes(qDiv, usageid, slot);
      info.choices = cbs.map((cb, i) => ({
        index: getChoiceIndexFromName(cb.name) ?? i,
        text: (qDiv.querySelector(`label[for="${cb.id}"]`)?.innerText ?? cb.name).trim()
      }));

    } else if (type === 'stack') {
      const ansNames = new Set();
      qDiv.querySelectorAll(`[name^="q${usageid}:${slot}_ans"]`).forEach(inp => {
        const m = inp.name.match(/_(ans\d+)$/);
        if (m) ansNames.add(m[1]);
      });
      info.answerFields = Array.from(ansNames);
    }

    return info;
  }

  // ============================================================
  // Prompt building
  // ============================================================

  function buildAnswerTemplate(q) {
    const entry = { slot: q.slot, type: q.type };
    switch (q.type) {
      case 'shortanswer': case 'essay': case 'regexp': case 'pmatch':
        entry.answer = '（回答テキスト）';
        break;
      case 'truefalse':
        entry.answer = '（1=True または 0=False）';
        break;
      case 'numerical': case 'calculated': case 'calculatedsimple':
        entry.answer = '（数値文字列）';
        if (q.unitOptions || q.hasUnitInput) entry.unit = '（単位）';
        break;
      case 'multichoice': case 'calculatedmulti': case 'multichoiceset':
        if (q.isMulti) entry.answers = [0]; // 正解インデックスの整数配列（例: [0, 2]）
        else entry.answer = '（選択肢のvalue値）';
        break;
      case 'match': case 'randomsamatch': {
        entry.answers = {};
        (q.subQuestions ?? []).forEach(sq => { entry.answers[String(sq.index)] = '（選択肢テキスト）'; });
        break;
      }
      case 'gapselect': {
        entry.answers = {};
        (q.gaps ?? []).forEach(g => { entry.answers[`p${g.place}`] = '（選択肢テキスト）'; });
        break;
      }
      case 'ddwtos': case 'ddimageortext': {
        entry.answers = {};
        (q.places ?? []).forEach(p => { entry.answers[String(p)] = '（語句テキスト）'; });
        break;
      }
      case 'ddmarker': {
        entry.answers = {};
        (q.choiceNums ?? []).forEach(c => { entry.answers[String(c)] = '（x,y座標）'; });
        break;
      }
      case 'multianswer': {
        entry.answers = {};
        (q.subInputs ?? []).forEach(s => { entry.answers[`sub${s.index}`] = '（回答）'; });
        break;
      }
      case 'ordering':
        entry.order = q.items ?? [];
        break;
      case 'oumultiresponse':
        entry.answers = [0]; // 正解インデックスの整数配列（例: [0, 2]）
        break;
      case 'stack': {
        entry.answers = {};
        (q.answerFields ?? []).forEach(f => { entry.answers[f] = '（Maxima形式の式）'; });
        break;
      }
    }
    return entry;
  }

  function buildPrompt(infos) {
    const template = { questions: infos.map(buildAnswerTemplate) };

    const lines = [
      '以下のMoodleテストの問題に正確に答えてください。',
      '必ず下記のJSON形式のみで返答してください。余分な説明やコードブロック（```）は不要です。JSONのみを返してください。',
      '',
      JSON.stringify(template, null, 2),
      '',
      '【問題一覧】'
    ];

    infos.forEach(q => {
      lines.push('');
      lines.push(`[slot:${q.slot}] 種類: ${q.type}`);
      lines.push(`問題文: ${q.questionText}`);
      if (q.images?.length) {
        lines.push('画像:');
        q.images.forEach(img => {
          const alt = img.alt ? ` alt="${img.alt}"` : '';
          lines.push(`  [slot:${q.slot} image:${img.index}] ${img.mimeType} ${img.width}x${img.height}${alt}`);
          if (img.combinedFrom?.length) {
            lines.push(`    ※ この画像は元画像${img.combinedFrom.length}枚を並べた合成画像です。各パネルの "image N" ラベルを参照してください。`);
            img.combinedFrom.forEach(src => {
              const srcAlt = src.alt ? ` alt="${src.alt}"` : '';
              lines.push(`    元画像 image ${src.index}: ${src.width}x${src.height}${srcAlt}`);
            });
          }
        });
      }

      switch (q.type) {
        case 'numerical': case 'calculated': case 'calculatedsimple':
          if (q.unitOptions) lines.push(`単位の選択肢: ${q.unitOptions.join(', ')}`);
          else if (q.hasUnitInput) lines.push('単位: テキストで入力してください');
          break;
        case 'truefalse':
          lines.push('選択肢: 1=True, 0=False');
          break;
        case 'multichoice': case 'calculatedmulti': case 'multichoiceset':
          if (q.isMulti) {
            lines.push('【複数選択可】正しい選択肢を全て選んでください。');
            lines.push('answersフィールドには正解の選択肢番号（0始まりの整数）を配列で返してください。例: "answers": [0, 2]');
            lines.push('選択肢（番号: テキスト）:');
            (q.choices ?? []).forEach(c => lines.push(`  ${c.index}: ${c.text}`));
          } else {
            lines.push('（単一選択）選択肢:');
            (q.choices ?? []).forEach(c => lines.push(`  value="${c.value}": ${c.text}`));
          }
          break;
        case 'match': case 'randomsamatch':
          lines.push(`選択肢プール: ${(q.options ?? []).join(', ')}`);
          lines.push('サブ問題:');
          (q.subQuestions ?? []).forEach(sq => lines.push(`  ${sq.index}: ${sq.text}`));
          break;
        case 'gapselect':
          lines.push('穴埋め問題（各空欄の選択肢）:');
          (q.gaps ?? []).forEach(g => lines.push(`  p${g.place}: ${g.options.join(' / ')}`));
          break;
        case 'ddwtos': case 'ddimageortext':
          lines.push(`使用可能な語句: ${Object.values(q.dragItems ?? {}).join(', ')}`);
          lines.push(`空欄の番号: ${(q.places ?? []).join(', ')}`);
          break;
        case 'ddmarker':
          lines.push(`マーカーの種類: ${JSON.stringify(q.markerLabels ?? {})}`);
          lines.push('※ 各マーカーを配置すべき座標をx,y形式で指定してください');
          break;
        case 'multianswer':
          lines.push('複合問題のサブ問題:');
          (q.subInputs ?? []).forEach(s => {
            if (s.subType === 'text') {
              lines.push(`  sub${s.index}: テキスト入力`);
            } else {
              lines.push(`  sub${s.index} (${s.subType}): ${s.options.map(o => o.text).join(' / ')}`);
            }
          });
          break;
        case 'ordering':
          lines.push('並べ替え問題。正しい順序に並べ直してください。アイテム:');
          (q.items ?? []).forEach((item, i) => lines.push(`  ${i + 1}. ${item}`));
          break;
        case 'oumultiresponse':
          lines.push('（複数選択可）選択肢:');
          (q.choices ?? []).forEach(c => lines.push(`  インデックス${c.index}: ${c.text}`));
          break;
        case 'stack':
          lines.push(`数式入力（Maxima形式で記述）。入力フィールド: ${(q.answerFields ?? []).join(', ')}`);
          break;
      }
    });

    return lines.join('\n');
  }

  // ============================================================
  // AI API calls
  // ============================================================

  function buildOpenAIContent(prompt, images) {
    const content = [{ type: 'text', text: prompt }];
    (images ?? []).forEach(img => {
      content.push({
        type: 'text',
        text: `[slot:${img.slot} image:${img.index}]`
      });
      content.push({
        type: 'image_url',
        image_url: {
          url: img.dataUrl,
          detail: 'auto'
        }
      });
    });
    return content;
  }

  function buildGeminiParts(prompt, images) {
    const parts = [{ text: prompt }];
    (images ?? []).forEach(img => {
      parts.push({ text: `[slot:${img.slot} image:${img.index}]` });
      parts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.base64
        }
      });
    });
    return parts;
  }

  function parseErrorBody(text) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  function getRetryDelay(errorBody) {
    const details = errorBody?.error?.details;
    if (!Array.isArray(details)) return '';

    const retry = details.find(d => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
    return retry?.retryDelay ?? '';
  }

  function formatGeminiApiError(status, rawText, modelName) {
    const body = parseErrorBody(rawText);
    const err = body?.error;
    const message = err?.message || rawText;
    const retryDelay = getRetryDelay(body);
    const isQuotaError = status === 429 || err?.status === 'RESOURCE_EXHAUSTED';

    if (!isQuotaError) {
      return `Gemini APIエラー ${status}: ${message}`;
    }

    const lines = [
      'Gemini APIの利用上限に達しています。',
      `モデル: ${modelName}`
    ];

    if (retryDelay) {
      lines.push(`分単位の制限であれば ${retryDelay} 後に再試行できます。`);
    }

    if (message.includes('limit: 0')) {
      lines.push('ただし limit: 0 が出ているため、このAPIキー/プロジェクトでは無料枠が使えない状態の可能性があります。');
    }

    lines.push('対処: Gemini Webに切り替える、別モデルを試す、Google AI Studioで課金/Quota設定を確認する、またはOpenAI APIを使ってください。');
    return lines.join('\n');
  }

  async function callOpenAI(apiKey, model, prompt, images = []) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content: buildOpenAIContent(prompt, images) }],
        temperature: 0
      })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI APIエラー ${res.status}: ${err}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  }

  async function callGemini(apiKey, model, prompt, images = []) {
    const modelName = model || 'gemini-1.5-pro';
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: buildGeminiParts(prompt, images) }],
          generationConfig: { temperature: 0 }
        })
      }
    );
    if (!res.ok) {
      const err = await res.text();
      console.error('[Moodle AI] Gemini API raw error:', err);
      throw new Error(formatGeminiApiError(res.status, err, modelName));
    }
    const data = await res.json();
    return data.candidates[0].content.parts[0].text;
  }

  function parseAIResponse(text) {
    // Strip markdown code fences if present
    const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AIのレスポンスからJSONを抽出できませんでした');
    return JSON.parse(jsonMatch[0]);
  }

  // ============================================================
  // Answer setters
  // ============================================================

  function applyAnswer(qDiv, answerData) {
    const ids = getIds(qDiv);
    if (!ids) return;
    const { usageid, slot } = ids;
    const type = detectType(qDiv);

    switch (type) {
      case 'shortanswer':
      case 'essay':
      case 'regexp':
      case 'pmatch': {
        const inp = qDiv.querySelector(`[name="q${usageid}:${slot}_answer"]`);
        if (inp && answerData.answer != null) {
          inp.value = String(answerData.answer);
          fireEvents(inp);
        }
        break;
      }

      case 'numerical':
      case 'calculated':
      case 'calculatedsimple': {
        const inp = qDiv.querySelector(`[name="q${usageid}:${slot}_answer"]`);
        if (inp && answerData.answer != null) {
          inp.value = String(answerData.answer);
          fireEvents(inp);
        }
        if (answerData.unit != null) {
          const unitVal = String(answerData.unit);
          const unitEls = qDiv.querySelectorAll(`[name="q${usageid}:${slot}_unit"]`);
          if (unitEls.length > 0) {
            const first = unitEls[0];
            if (first.tagName === 'SELECT' || first.type === 'text') {
              first.value = unitVal;
              fireEvents(first);
            } else if (first.type === 'radio') {
              unitEls.forEach(r => { r.checked = (r.value === unitVal); });
              fireEvents(unitEls[0]);
            }
          }
        }
        break;
      }

      case 'truefalse': {
        const radio = qDiv.querySelector(`input[type="radio"][name="q${usageid}:${slot}_answer"][value="${answerData.answer}"]`);
        if (radio) radio.click();
        break;
      }

      case 'multichoice':
      case 'calculatedmulti': {
        const cbs = collectMultiChoiceCheckboxes(qDiv, usageid, slot);
        if (cbs.length > 0 && answerData.answers != null) {
          // Multi-response checkboxes — handle both numbers and numeric strings
          const raw = Array.isArray(answerData.answers) ? answerData.answers : [answerData.answers];
          const indices = raw.map(x => parseInt(String(x), 10)).filter(n => !isNaN(n));
          cbs.forEach((cb, i) => {
            const idx = getChoiceIndexFromName(cb.name) ?? i;
            cb.checked = indices.includes(idx);
            fireEvents(cb);
          });
        } else if (answerData.answer != null) {
          const radio = qDiv.querySelector(`input[type="radio"][name="q${usageid}:${slot}_answer"][value="${answerData.answer}"]`);
          if (radio) radio.click();
        }
        break;
      }

      case 'multichoiceset': {
        const cbs = collectMultiChoiceCheckboxes(qDiv, usageid, slot);
        if (answerData.answers != null) {
          const raw = Array.isArray(answerData.answers) ? answerData.answers : [answerData.answers];
          const indices = raw.map(x => parseInt(String(x), 10)).filter(n => !isNaN(n));
          cbs.forEach((cb, i) => {
            const idx = getChoiceIndexFromName(cb.name) ?? i;
            cb.checked = indices.includes(idx);
            fireEvents(cb);
          });
        } else if (answerData.answer != null) {
          const radio = qDiv.querySelector(`input[type="radio"][name="q${usageid}:${slot}_answer"][value="${answerData.answer}"]`);
          if (radio) radio.click();
        }
        break;
      }

      case 'match':
      case 'randomsamatch': {
        const mapping = answerData.answers ?? {};
        for (const [i, wantText] of Object.entries(mapping)) {
          const sel = qDiv.querySelector(`select[name="q${usageid}:${slot}_sub${i}"]`);
          if (!sel) continue;
          for (const opt of sel.options) {
            if (opt.text.trim() === wantText) { sel.value = opt.value; break; }
          }
          fireEvents(sel);
        }
        break;
      }

      case 'gapselect': {
        const answers = answerData.answers ?? {};
        for (const [key, wantText] of Object.entries(answers)) {
          const place = key.replace('p', '');
          const sel = qDiv.querySelector(`select[name="q${usageid}:${slot}_p${place}"]`);
          if (!sel) continue;
          for (const opt of sel.options) {
            if (opt.text.trim() === wantText) { sel.value = opt.value; break; }
          }
          fireEvents(sel);
        }
        break;
      }

      case 'ddwtos':
      case 'ddimageortext': {
        const textToChoice = {};
        qDiv.querySelectorAll('.draghome[data-choice]').forEach(el => {
          textToChoice[el.textContent.trim()] = el.dataset.choice;
        });
        for (const [place, text] of Object.entries(answerData.answers ?? {})) {
          const inp = qDiv.querySelector(`input[name="q${usageid}:${slot}_p${place}"]`);
          if (!inp) continue;
          const choice = textToChoice[text];
          if (choice != null) {
            inp.value = String(choice);
            fireEvents(inp);
          }
        }
        break;
      }

      case 'ddmarker': {
        for (const [choice, coords] of Object.entries(answerData.answers ?? {})) {
          const inp = qDiv.querySelector(`input[name="q${usageid}:${slot}_c${choice}"]`);
          if (!inp) continue;
          inp.value = String(coords);
          fireEvents(inp);
        }
        break;
      }

      case 'multianswer': {
        const answers = answerData.answers ?? {};
        for (const [key, val] of Object.entries(answers)) {
          const i = key.replace('sub', '');
          const valStr = String(val);
          const els = qDiv.querySelectorAll(`[name="q${usageid}:${slot}_sub${i}_answer"]`);
          if (els.length === 0) continue;
          if (els.length === 1) {
            if (els[0].tagName === 'SELECT') {
              for (const opt of els[0].options) {
                if (opt.value === valStr || opt.text.trim() === valStr) {
                  els[0].value = opt.value;
                  break;
                }
              }
            } else {
              els[0].value = valStr;
            }
            fireEvents(els[0]);
          } else if (els[0].type === 'radio') {
            els.forEach(r => { r.checked = (r.value === valStr); });
            fireEvents(els[0]);
          }
        }
        break;
      }

      case 'ordering': {
        const orderedTexts = answerData.order ?? [];
        const items = Array.from(qDiv.querySelectorAll('li.sortableitem'));
        const textToId = {};
        items.forEach(li => { textToId[li.textContent.trim()] = li.dataset.itemid || li.id; });
        const idsInOrder = orderedTexts.map(t => textToId[t]).filter(Boolean);

        const hidden = qDiv.querySelector('input[type="hidden"][name*="_response_"]');
        if (hidden && idsInOrder.length > 0) {
          hidden.value = idsInOrder.join(',');
          fireEvents(hidden);
          // Update visual order
          const ul = items[0]?.parentElement;
          if (ul) {
            idsInOrder.forEach(id => {
              const li = items.find(x => (x.dataset.itemid || x.id) === id);
              if (li) ul.appendChild(li);
            });
          }
        }
        break;
      }

      case 'oumultiresponse': {
        const raw = Array.isArray(answerData.answers) ? answerData.answers : [];
        const indices = raw.map(x => parseInt(String(x), 10)).filter(n => !isNaN(n));
        collectMultiChoiceCheckboxes(qDiv, usageid, slot).forEach((cb, i) => {
          const idx = getChoiceIndexFromName(cb.name) ?? i;
          cb.checked = indices.includes(idx);
          fireEvents(cb);
        });
        break;
      }

      case 'stack': {
        for (const [name, val] of Object.entries(answerData.answers ?? {})) {
          const inp = qDiv.querySelector(`[name="q${usageid}:${slot}_${name}"]`);
          if (!inp) continue;
          inp.value = String(val);
          fireEvents(inp);
        }
        break;
      }
    }
  }

  // ============================================================
  // Main flow
  // ============================================================

  async function runAI(updateStatus) {
    const qDivs = Array.from(document.querySelectorAll('.que'));
    if (qDivs.length === 0) throw new Error('問題が見つかりませんでした');

    const infos = [];
    qDivs.forEach((qDiv, i) => {
      try {
        const info = extractInfo(qDiv);
        if (info) {
          infos.push(info);
        } else {
          const id = qDiv.id || `(index:${i})`;
          const classes = Array.from(qDiv.classList).join(' ');
          console.warn('[Moodle AI] skipped question (unknown type):', id, classes);
        }
      } catch (e) {
        const id = qDiv.id || `(index:${i})`;
        console.error('[Moodle AI] extractInfo failed:', id, e);
      }
    });
    if (infos.length === 0) throw new Error('対応している問題タイプが見つかりませんでした');

    // Fetch settings — wrap in try-catch to detect invalidated extension context
    let settings;
    try {
      settings = await new Promise((resolve, reject) => {
        chrome.storage.local.get(['provider', 'apiKey', 'model'], data => {
          if (chrome.runtime.lastError) {
            reject(new Error('設定の読み込みに失敗: ' + chrome.runtime.lastError.message));
          } else {
            resolve(data);
          }
        });
      });
    } catch (e) {
      throw new Error('拡張機能の接続エラー。ページを再読み込み（F5）してください。\n詳細: ' + e.message);
    }

    console.log('[Moodle AI] Settings:', {
      provider: settings.provider ?? '(未設定)',
      hasApiKey: !!settings.apiKey,
      model: settings.model ?? '(未設定)'
    });

    const isWebProvider = settings.provider === 'chatgpt-web' || settings.provider === 'gemini-web';
    if (!isWebProvider && !settings.apiKey) {
      throw new Error(
        'APIキーが設定されていません。\n' +
        '拡張機能アイコン → ポップアップ でAPIキーを入力して保存してください。\n' +
        'APIキー不要の場合は「ChatGPT Web」または「Gemini Web」を選択してください。'
      );
    }

    console.log('[Moodle AI] Detected questions:', infos.map(q => `slot${q.slot}(${q.type})`).join(', '));
    updateStatus(`${infos.length}問を解析中...`);
    const images = await attachImages(infos, qDivs);
    if (images.length > 0) {
      updateStatus(`${images.length}枚の画像を含めてプロンプトを生成中...`);
      console.log('[Moodle AI] Attached images:', images.map(img => `slot${img.slot}#${img.index} ${img.mimeType} ${img.width}x${img.height}`).join(', '));
    } else {
      updateStatus(`${infos.length}問のプロンプトを生成中...`);
    }
    const prompt = buildPrompt(infos);
    console.log('[Moodle AI] Prompt length:', prompt.length, 'chars');
    console.log('[Moodle AI] Prompt preview:\n', prompt.slice(0, 300));

    let responseText;

    if (settings.provider === 'chatgpt-web' || settings.provider === 'gemini-web') {
      const provider = settings.provider === 'chatgpt-web' ? 'chatgpt' : 'gemini';
      const label    = settings.provider === 'chatgpt-web' ? 'ChatGPT' : 'Gemini';
      updateStatus(`${label} タブを開いています...`);

      let res;
      try {
        res = await chrome.runtime.sendMessage({ action: 'askWebAI', provider, prompt, images });
      } catch (e) {
        const msg = e.message ?? String(e);
        if (msg.includes('context invalidated') || msg.includes('Receiving end does not exist')) {
          throw new Error('拡張機能の接続が切れています。ページを再読み込み（F5）してください。');
        }
        throw new Error(`バックグラウンドスクリプト接続エラー: ${msg}`);
      }

      if (!res?.success) {
        throw new Error(res?.error ?? `${label}から回答を取得できませんでした`);
      }
      responseText = res.text;

    } else if (settings.provider === 'gemini') {
      updateStatus(images.length ? `Gemini APIに画像${images.length}枚を送信中...` : 'Gemini APIに送信中...');
      responseText = await callGemini(settings.apiKey, settings.model, prompt, images);

    } else {
      updateStatus(images.length ? `OpenAI APIに画像${images.length}枚を送信中...` : 'OpenAI APIに送信中...');
      responseText = await callOpenAI(settings.apiKey, settings.model, prompt, images);
    }

    updateStatus('回答を適用中...');
    const parsed = parseAIResponse(responseText);
    const answersMap = {};
    (parsed.questions ?? []).forEach(a => { answersMap[a.slot] = a; });

    let applied = 0;
    qDivs.forEach(qDiv => {
      const ids = getIds(qDiv);
      if (!ids) return;
      const answer = answersMap[parseInt(ids.slot)];
      if (!answer) return;
      try {
        applyAnswer(qDiv, answer);
        applied++;
      } catch (e) {
        console.error(`[Moodle AI] slot ${ids.slot} 適用エラー:`, e);
      }
    });

    return applied;
  }

  // ============================================================
  // Floating button UI
  // ============================================================

  function createUI() {
    const btn = document.createElement('button');
    btn.id = 'moodle-ai-quiz-btn';
    btn.textContent = 'AIで解答';

    Object.assign(btn.style, {
      position:        'fixed',
      bottom:          '24px',
      right:           '24px',
      zIndex:          '99999',
      padding:         '12px 22px',
      backgroundColor: '#1a73e8',
      color:           '#fff',
      border:          'none',
      borderRadius:    '8px',
      fontSize:        '15px',
      fontWeight:      'bold',
      cursor:          'pointer',
      boxShadow:       '0 3px 10px rgba(0,0,0,0.3)',
      transition:      'background-color 0.2s',
      lineHeight:      '1.4'
    });

    const statusDiv = document.createElement('div');
    Object.assign(statusDiv.style, {
      position:        'fixed',
      bottom:          '70px',
      right:           '24px',
      zIndex:          '99999',
      padding:         '6px 12px',
      backgroundColor: 'rgba(0,0,0,0.75)',
      color:           '#fff',
      borderRadius:    '6px',
      fontSize:        '13px',
      display:         'none',
      maxWidth:        '280px'
    });

    function updateStatus(msg) {
      statusDiv.textContent = msg;
      statusDiv.style.display = msg ? 'block' : 'none';
    }

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;

      // Extension context becomes invalid after reloading the extension without refreshing the page
      if (!chrome.runtime?.id) {
        showError('拡張機能が更新されました。ページを再読み込み（F5）してから再試行してください。');
        return;
      }

      btn.disabled = true;
      btn.style.backgroundColor = '#5f9ea0';
      btn.textContent = '処理中...';
      updateStatus('開始中...');

      try {
        const applied = await runAI(updateStatus);
        btn.textContent = `解答完了 (${applied}問)`;
        btn.style.backgroundColor = '#34a853';
        updateStatus('');
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = 'AIで解答';
          btn.style.backgroundColor = '#1a73e8';
        }, 3000);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'AIで解答';
        btn.style.backgroundColor = '#1a73e8';
        showError(e.message);
        console.error('[Moodle AI] Error:', e);
      }
    });

    function showError(msg) {
      statusDiv.textContent = '⚠ ' + msg;
      statusDiv.style.display = 'block';
      statusDiv.style.backgroundColor = 'rgba(180,0,0,0.9)';
      statusDiv.style.fontSize = '13px';
      statusDiv.style.maxWidth = '380px';
      statusDiv.style.whiteSpace = 'pre-line';
      // Clear after 20 seconds
      clearTimeout(statusDiv._clearTimer);
      statusDiv._clearTimer = setTimeout(() => {
        statusDiv.style.display = 'none';
        statusDiv.style.backgroundColor = 'rgba(0,0,0,0.75)';
      }, 20000);
    }

    document.body.appendChild(statusDiv);
    document.body.appendChild(btn);
  }

  createUI();
})();
