'use strict';

const providerEl  = document.getElementById('provider');
const modelEl     = document.getElementById('model');
const apiKeyEl    = document.getElementById('apiKey');
const toggleBtn   = document.getElementById('toggleKey');
const saveBtn     = document.getElementById('save');
const statusEl    = document.getElementById('status');
const apiFieldsEl = document.getElementById('api-fields');
const webInfoEl   = document.getElementById('web-info');
const webInfoSite = document.getElementById('web-info-site');
const geminiToolsEl = document.getElementById('gemini-model-tools');
const refreshGeminiBtn = document.getElementById('refreshGeminiModels');

const DEFAULT_GEMINI_MODELS = [
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' }
];

const EXCLUDED_GEMINI_MODEL_WORDS = [
  'embedding', 'embed', 'imagen', 'veo', 'aqa', 'tts', 'audio',
  'image-generation', 'learnlm'
];

// ── Load saved settings ──────────────────────────────────────────────────────

chrome.storage.local.get(['provider', 'apiKey', 'model', 'geminiModels'], (data) => {
  if (data.provider) providerEl.value = data.provider;
  if (data.apiKey)   apiKeyEl.value   = data.apiKey;
  if (Array.isArray(data.geminiModels) && data.geminiModels.length > 0) {
    setGeminiModelOptions(data.geminiModels);
  }
  updateUI();
  if (data.model) {
    const opt = modelEl.querySelector(`option[value="${data.model}"]`);
    if (opt && !opt.hidden) modelEl.value = data.model;
  }
});

// ── UI update helpers ────────────────────────────────────────────────────────

function isWebProvider(val) {
  return val === 'chatgpt-web' || val === 'gemini-web';
}

function updateUI() {
  const provider = providerEl.value;
  const web = isWebProvider(provider);
  const isGeminiApi = provider === 'gemini';

  // Show/hide API fields vs web info
  apiFieldsEl.style.display = web ? 'none' : 'block';
  webInfoEl.style.display   = web ? 'block' : 'none';
  geminiToolsEl.style.display = !web && isGeminiApi ? 'block' : 'none';

  if (web) {
    webInfoSite.textContent =
      provider === 'chatgpt-web' ? 'chatgpt.com' : 'gemini.google.com';
  }

  // Filter model options to match API provider
  if (!web) {
    const apiProvider = provider; // 'openai' or 'gemini'
    Array.from(modelEl.options).forEach(opt => {
      const group = opt.closest('optgroup');
      const forProvider = group ? group.dataset.provider : null;
      opt.hidden = forProvider !== null && forProvider !== apiProvider;
    });
    // Ensure current value is visible; otherwise pick first visible
    const current = modelEl.querySelector(`option[value="${modelEl.value}"]`);
    if (!current || current.hidden) {
      const first = modelEl.querySelector('option:not([hidden])');
      if (first) modelEl.value = first.value;
    }
  }
}

providerEl.addEventListener('change', updateUI);

// ── Gemini model refresh ─────────────────────────────────────────────────────

function getGeminiGroup() {
  return modelEl.querySelector('optgroup[data-provider="gemini"]');
}

function setGeminiModelOptions(models) {
  const group = getGeminiGroup();
  if (!group) return;

  group.textContent = '';
  models.forEach(model => {
    const opt = document.createElement('option');
    opt.value = model.id;
    opt.textContent = model.label || model.id;
    group.appendChild(opt);
  });
}

function normalizeGeminiModel(model) {
  const id = (model.baseModelId || model.name || '').replace(/^models\//, '');
  const label = model.displayName || id;
  return { id, label };
}

function isMajorGeminiModel(model) {
  const methods = model.supportedGenerationMethods || [];
  const normalized = normalizeGeminiModel(model);
  const haystack = `${normalized.id} ${normalized.label}`.toLowerCase();

  if (!methods.includes('generateContent')) return false;
  if (!normalized.id.startsWith('gemini-')) return false;
  if (EXCLUDED_GEMINI_MODEL_WORDS.some(word => haystack.includes(word))) return false;

  return /gemini-\d+(\.\d+)?-(flash|pro|flash-lite)/.test(normalized.id);
}

function modelPriority(model) {
  const id = model.id.toLowerCase();
  let score = 0;

  const version = id.match(/gemini-(\d+)(?:\.(\d+))?/);
  if (version) score += parseInt(version[1], 10) * 100 + parseInt(version[2] || '0', 10) * 10;

  if (id.includes('-pro')) score += 6;
  if (id.includes('-flash')) score += 4;
  if (id.includes('-flash-lite')) score += 2;
  if (id.includes('latest')) score -= 1;
  if (/-\d{3}$/.test(id)) score -= 3;
  if (id.includes('preview') || id.includes('exp')) score -= 20;

  return score;
}

function dedupeAndLimitGeminiModels(models) {
  const byId = new Map();
  models
    .map(normalizeGeminiModel)
    .filter(model => model.id)
    .sort((a, b) => modelPriority(b) - modelPriority(a) || a.id.localeCompare(b.id))
    .forEach(model => {
      if (!byId.has(model.id)) byId.set(model.id, model);
    });

  return Array.from(byId.values()).slice(0, 8);
}

async function fetchGeminiModels(apiKey) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`);
  const text = await res.text();

  if (!res.ok) {
    let message = text;
    try {
      message = JSON.parse(text)?.error?.message || text;
    } catch (_) {}
    throw new Error(`Geminiモデル一覧の取得に失敗しました (${res.status}): ${message}`);
  }

  const data = JSON.parse(text);
  return dedupeAndLimitGeminiModels((data.models || []).filter(isMajorGeminiModel));
}

refreshGeminiBtn.addEventListener('click', async () => {
  const apiKey = apiKeyEl.value.trim();
  if (!apiKey) {
    showStatus('Gemini APIキーを入力してから更新してください', true);
    return;
  }

  refreshGeminiBtn.disabled = true;
  refreshGeminiBtn.textContent = '更新中...';

  try {
    const current = modelEl.value;
    const models = await fetchGeminiModels(apiKey);
    if (models.length === 0) {
      setGeminiModelOptions(DEFAULT_GEMINI_MODELS);
      showStatus('主要なGeminiモデルが見つかりませんでした', true);
      return;
    }

    setGeminiModelOptions(models);
    if (models.some(model => model.id === current)) {
      modelEl.value = current;
    } else {
      modelEl.value = models[0].id;
    }
    updateUI();

    chrome.storage.local.set({ geminiModels: models, model: modelEl.value }, () => {
      showStatus(`${models.length}件のGeminiモデルを更新しました`, false);
    });
  } catch (e) {
    showStatus(e.message || String(e), true);
  } finally {
    refreshGeminiBtn.disabled = false;
    refreshGeminiBtn.textContent = 'Geminiモデル一覧を更新';
  }
});

// ── API key visibility toggle ────────────────────────────────────────────────

toggleBtn.addEventListener('click', () => {
  const hidden = apiKeyEl.type === 'password';
  apiKeyEl.type        = hidden ? 'text' : 'password';
  toggleBtn.textContent = hidden ? '🙈' : '👁';
});

// ── Save ─────────────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', () => {
  const provider = providerEl.value;
  const web = isWebProvider(provider);

  if (!web && !apiKeyEl.value.trim()) {
    showStatus('APIキーを入力してください', true);
    return;
  }

  const settings = { provider };
  if (!web) {
    settings.apiKey = apiKeyEl.value.trim();
    settings.model  = modelEl.value;
  }

  chrome.storage.local.set(settings, () => {
    showStatus('設定を保存しました ✓', false);
  });
});

// ── Utility ──────────────────────────────────────────────────────────────────

function showStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className   = isError ? 'error' : '';
  clearTimeout(statusEl._clearTimer);
  statusEl._clearTimer = setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = '';
  }, isError ? 7000 : 2500);
}
