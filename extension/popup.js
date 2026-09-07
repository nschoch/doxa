// Popup controller for Doxa.
// The popup is a trigger + settings panel. Clicking a button tells the content
// script to run the job (collect comments OR grab a video transcript) and show
// an on-page card, so it survives the popup closing / the user switching tabs.

const $ = (s) => document.querySelector(s);

const els = {
  summarizeBtn: $("#summarizeBtn"),
  geminiBtn: $("#geminiBtn"),
  status: $("#status"),
  provider: $("#provider"),
  ollamaGroup: $("#ollamaGroup"),
  onlineGroup: $("#onlineGroup"),
  ninferGroup: $("#ninferGroup"),
  apiKeyGroup: $("#apiKeyGroup"),
  ollamaUrl: $("#ollamaUrl"),
  model: $("#model"),
  openrouterModel: $("#openrouterModel"),
  ninferUrl: $("#ninferUrl"),
  ninferModel: $("#ninferModel"),
  apiKey: $("#apiKey"),
  youtubeApiKey: $("#youtubeApiKey"),
  siteReddit: $("#siteReddit"),
  siteYoutube: $("#siteYoutube"),
  fetchModelsBtn: $("#fetchModelsBtn"),
  modelsList: $("#modelsList"),
  timeoutSec: $("#timeoutSec"),
  maxComments: $("#maxComments"),
  autoSave: $("#autoSave"),
  saveBtn: $("#saveBtn"),
  helpLink: $("#helpLink"),
};

const DEFAULTS = {
  provider: "ollama",
  ollamaUrl: "http://10.20.10.99:11434",
  model: "qwen3.6:35b-a3b",
  openrouterModel: "openai/gpt-4o-mini",
  ninferUrl: "http://10.20.10.99:8000/v1",
  ninferModel: "qwen3.6-27b-ninfer",
  timeoutSec: 180,
  maxComments: 300,
};

init();

async function init() {
  bind();
  await loadSettings();
  refreshButtonState();
}

function bind() {
  els.summarizeBtn.addEventListener("click", doSummarize);
  els.geminiBtn.addEventListener("click", doGemini);
  els.saveBtn.addEventListener("click", saveSettings);
  els.fetchModelsBtn.addEventListener("click", fetchModels);
  els.modelsList.addEventListener("change", () => {
    activeModelInput().value = els.modelsList.value;
    if (els.autoSave.checked) saveSettings();
  });
  els.youtubeApiKey.addEventListener("input", refreshButtonState);
  els.provider.addEventListener("change", () => {
    updateVisibility();
    refreshButtonState();
    if (els.autoSave.checked) saveSettings();
  });
  els.siteReddit.addEventListener("change", () => {
    saveSettings();
    refreshButtonState();
  });
  els.siteYoutube.addEventListener("change", () => {
    saveSettings();
    refreshButtonState();
  });
  els.autoSave.addEventListener("change", () => {
    if (els.autoSave.checked) saveSettings();
  });
  els.helpLink.addEventListener("click", (e) => {
    e.preventDefault();
    setStatus(
      "info",
      "Ollama: run server with OLLAMA_ORIGINS=*, set its URL. OpenRouter: set a model + API key. " +
        "Ninfer: set its URL + model (key optional on a local server). Raise Timeout if a large " +
        "local model is slow. You can ask a follow-up in the card after a summary.",
    );
  });
  [
    els.ollamaUrl,
    els.model,
    els.openrouterModel,
    els.ninferUrl,
    els.ninferModel,
    els.apiKey,
    els.youtubeApiKey,
    els.timeoutSec,
    els.maxComments,
  ].forEach((el) => {
    el.addEventListener("input", () => {
      if (els.autoSave.checked) saveSettings();
    });
  });
}

function updateVisibility() {
  const p = els.provider.value;
  const isOllama = p === "ollama";
  const isOpenrouter = p === "openrouter";
  const isNinfer = p === "ninfer";
  els.ollamaGroup.classList.toggle("hidden", !isOllama);
  els.onlineGroup.classList.toggle("hidden", !isOpenrouter);
  els.ninferGroup.classList.toggle("hidden", !isNinfer);
  // API key is shared by online providers (OpenRouter requires it; Ninfer optional).
  els.apiKeyGroup.classList.toggle("hidden", isOllama);
}

// Show/hide + enable/disable buttons based on the current tab's site, the
// enabled-sites config, and (for YouTube) whether a Data API key is set.
async function refreshButtonState() {
  const hasKey = !!els.youtubeApiKey.value.trim();
  const sites = buildSites();
  let host = "";
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    host = tabs && tabs[0] && tabs[0].url ? hostFromUrl(tabs[0].url) : "";
  } catch (_) {}

  const isReddit = host.includes("reddit.com");
  const isYoutube = host.includes("youtube.com");
  // Ghost the YouTube site toggle until a Data API key is entered.
  els.siteYoutube.disabled = !hasKey;
  const redditOn = isReddit && sites.includes("reddit");
  const youtubeOn = isYoutube && sites.includes("youtube") && hasKey;
  const enabled = redditOn || youtubeOn;

  // "Summarize with Gemini" appears on any YouTube video (hand-off; no key needed).
  const geminiVisible = isYoutube && sites.includes("youtube");
  els.geminiBtn.classList.toggle("hidden", !geminiVisible);

  els.summarizeBtn.disabled = !enabled;

  if (enabled) {
    els.status.classList.add("hidden");
  } else if (isYoutube && sites.includes("youtube") && !hasKey) {
    setStatus("info", "Add a YouTube Data API key in Settings to summarize this video.");
  } else {
    setStatus("info", "This site is disabled in Settings.");
  }
}

function hostFromUrl(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return "";
  }
}

// --- Settings ---

async function loadSettings() {
  try {
    const s = await browser.storage.local.get([
      "provider",
      "ollamaUrl",
      "model",
      "openrouterModel",
      "ninferUrl",
      "ninferModel",
      "apiKey",
      "youtubeApiKey",
      "sites",
      "timeoutSec",
      "maxComments",
    ]);
    els.provider.value = s.provider || DEFAULTS.provider;
    els.ollamaUrl.value = s.ollamaUrl || DEFAULTS.ollamaUrl;
    els.model.value = s.model || DEFAULTS.model;
    els.openrouterModel.value = s.openrouterModel || DEFAULTS.openrouterModel;
    els.ninferUrl.value = s.ninferUrl || DEFAULTS.ninferUrl;
    els.ninferModel.value = s.ninferModel || DEFAULTS.ninferModel;
    els.apiKey.value = s.apiKey || "";
    els.youtubeApiKey.value = s.youtubeApiKey || "";
    const sites = Array.isArray(s.sites) ? s.sites : ["reddit", "youtube"];
    els.siteReddit.checked = sites.includes("reddit");
    els.siteYoutube.checked = sites.includes("youtube");
    els.timeoutSec.value = s.timeoutSec || DEFAULTS.timeoutSec;
    els.maxComments.value = s.maxComments || DEFAULTS.maxComments;
  } catch (_) {
    els.ollamaUrl.value = DEFAULTS.ollamaUrl;
    els.model.value = DEFAULTS.model;
    els.openrouterModel.value = DEFAULTS.openrouterModel;
    els.ninferUrl.value = DEFAULTS.ninferUrl;
    els.ninferModel.value = DEFAULTS.ninferModel;
    els.timeoutSec.value = DEFAULTS.timeoutSec;
    els.maxComments.value = DEFAULTS.maxComments;
  }
  updateVisibility();
}

async function saveSettings() {
  await browser.storage.local.set({
    provider: els.provider.value,
    ollamaUrl: last(els.ollamaUrl.value, DEFAULTS.ollamaUrl),
    model: last(els.model.value, DEFAULTS.model),
    openrouterModel: last(els.openrouterModel.value, DEFAULTS.openrouterModel),
    ninferUrl: last(els.ninferUrl.value, DEFAULTS.ninferUrl),
    ninferModel: last(els.ninferModel.value, DEFAULTS.ninferModel),
    apiKey: els.apiKey.value.trim(),
    youtubeApiKey: els.youtubeApiKey.value.trim(),
    sites: buildSites(),
    timeoutSec: Number(els.timeoutSec.value) || DEFAULTS.timeoutSec,
    maxComments: Number(els.maxComments.value) || DEFAULTS.maxComments,
  });
}

function buildSites() {
  const sites = [];
  if (els.siteReddit.checked) sites.push("reddit");
  // YouTube only counts as enabled once a Data API key is present.
  if (els.siteYoutube.checked && els.youtubeApiKey.value.trim()) sites.push("youtube");
  return sites;
}

// --- Models ---

function activeModelInput() {
  const p = els.provider.value;
  if (p === "openrouter") return els.openrouterModel;
  if (p === "ninfer") return els.ninferModel;
  return els.model;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchModels() {
  setStatus("info", "Fetching available models…");
  const provider = els.provider.value;
  let resp;
  try {
    resp = await browser.runtime.sendMessage({
      type: "list-models",
      provider,
      ollamaUrl: last(els.ollamaUrl.value, DEFAULTS.ollamaUrl),
      apiKey: els.apiKey.value.trim(),
      ninferUrl: last(els.ninferUrl.value, DEFAULTS.ninferUrl),
      timeoutSec: 30,
    });
  } catch (e) {
    setStatus("err", "Could not fetch models: " + ((e && e.message) || e));
    return;
  }
  if (!resp || !resp.ok) {
    setStatus("err", (resp && resp.error) || "Could not fetch models.");
    return;
  }
  const models = resp.models || [];
  if (!models.length) {
    setStatus("err", "No models returned.");
    return;
  }
  els.modelsList.innerHTML = models
    .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    .join("");
  els.modelsList.classList.remove("hidden");
  setStatus(
    "info",
    `${models.length} model(s) loaded — pick one to fill the model field.`,
  );
}

// --- Actions ---

async function doSummarize() {
  setStatus("info", "Reading comments…");
  await sendToTab("start", "This isn't a supported page. Open a Reddit thread or a YouTube video.");
}

// Opens Gemini (gemini.google.com) in a new tab. The prompt is copied to the
// clipboard (Gemini strips URL prompt params, so we can't pre-fill); the user
// pastes it and presses Send. The tab opens in the background so the popup
// notice stays visible.
async function doGemini() {
  let tab;
  try {
    tab = await getActiveTab();
  } catch (_) {
    tab = null;
  }
  const url = (tab && tab.url) || "";
  if (!url.includes("youtube.com") || !url.includes("v=")) {
    setStatus("err", "Open a YouTube video, then try again.");
    return;
  }
  const prompt = `Summarize this video: ${url}`;
  // Gemini's web app strips URL prompt params (unsupported/redacted), so we can't
  // reliably pre-fill. Instead: copy the prompt to the clipboard and open a fresh
  // Gemini chat; the user pastes it (⌘V) and presses Send.
  let copied = false;
  try {
    await navigator.clipboard.writeText(prompt);
    copied = true;
  } catch (_) {
    /* clipboard unavailable */
  }
  const geminiUrl = "https://gemini.google.com/app";
  try {
    await browser.tabs.create({ url: geminiUrl, active: false });
  } catch (_) {
    window.open(geminiUrl, "_blank");
  }
  setStatus(
    "info",
    copied
      ? "Prompt copied to your clipboard. Gemini opened in a new tab — switch to it, press ⌘V, then Send."
      : "Gemini opened in a new tab. Paste the video URL and ask it to summarize.",
  );
}

async function sendToTab(type, errMsg) {
  let tab;
  try {
    tab = await getActiveTab();
  } catch (_) {
    tab = null;
  }
  if (!tab || !tab.id) {
    setStatus("err", "Could not find the active tab.");
    return;
  }
  await saveSettings();
  try {
    await browser.tabs.sendMessage(tab.id, { type });
  } catch (_) {
    setStatus("err", errMsg);
    return;
  }
  setStatus(
    "info",
    "Working… watch the card on the page. You can switch tabs — it keeps going.",
  );
}

function setStatus(type, text) {
  els.status.className = `status ${type}`;
  els.status.textContent = text;
  els.status.classList.remove("hidden");
}

// --- helpers ---

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0];
}

function last(value, fallback) {
  const v = String(value || "").trim();
  return v || fallback;
}
