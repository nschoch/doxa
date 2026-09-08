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
  openaiGroup: $("#openaiGroup"),
  apiKeyGroup: $("#apiKeyGroup"),
  ollamaUrl: $("#ollamaUrl"),
  model: $("#model"),
  openaiPreset: $("#openaiPreset"),
  openaiBaseUrl: $("#openaiBaseUrl"),
  openaiModel: $("#openaiModel"),
  apiKey: $("#apiKey"),
  youtubeApiKey: $("#youtubeApiKey"),
  siteReddit: $("#siteReddit"),
  siteYoutube: $("#siteYoutube"),
  fetchModelsBtn: $("#fetchModelsBtn"),
  modelsList: $("#modelsList"),
  timeoutSec: $("#timeoutSec"),
  maxComments: $("#maxComments"),
  redditPerThread: $("#redditPerThread"),
  autoSave: $("#autoSave"),
  saveBtn: $("#saveBtn"),
  helpLink: $("#helpLink"),
  updateBanner: $("#updateBanner"),
  updateDetail: $("#updateDetail"),
  viewReleaseBtn: $("#viewReleaseBtn"),
  dismissUpdateBtn: $("#dismissUpdateBtn"),
  versionLabel: $("#versionLabel"),
  checkUpdatesLink: $("#checkUpdatesLink"),
  insecureWarn: $("#insecureWarn"),
};

const DEFAULTS = {
  provider: "ollama",
  ollamaUrl: "http://localhost:11434",
  model: "qwen3.6:35b-a3b",
  openaiPreset: "custom",
  openaiBaseUrl: "http://localhost:8000/v1",
  openaiModel: "qwen3.6-27b-ninfer",
  timeoutSec: 180,
  maxComments: 300,
  redditPerThread: 30,
};

const RELEASES_PAGE = "https://github.com/nschoch/doxa/releases";
const README_URL = "https://github.com/nschoch/doxa";
const OPENROUTER_URL = "https://openrouter.ai/api/v1";
// Latest version we've shown the banner for (null until one is known).
let lastKnownUpdateVersion = null;
let lastKnownUpdateUrl = RELEASES_PAGE;
let savedTimer = null;

init();

async function init() {
  bind();
  await loadSettings();
  refreshButtonState();
  const manifest = browser.runtime.getManifest();
  els.versionLabel.textContent = `Doxa v${(manifest && manifest.version) || "?"}`;
  // Non-blocking: fetch/check in the background and show a banner if a newer
  // release exists. The popup stays fully usable while this runs.
  checkForUpdate(false);
}

function bind() {
  els.summarizeBtn.addEventListener("click", doSummarize);
  els.geminiBtn.addEventListener("click", doGemini);
  els.saveBtn.addEventListener("click", onManualSave);
  els.fetchModelsBtn.addEventListener("click", fetchModels);
  els.viewReleaseBtn.addEventListener("click", openUpdateUrl);
  els.dismissUpdateBtn.addEventListener("click", dismissUpdate);
  els.checkUpdatesLink.addEventListener("click", (e) => {
    e.preventDefault();
    manualUpdateCheck();
  });
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
  els.openaiPreset.addEventListener("change", () => {
    updateVisibility();
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
    browser.tabs
      .create({ url: README_URL, active: true })
      .catch(() => window.open(README_URL, "_blank"));
  });
  [
    els.ollamaUrl,
    els.model,
    els.openaiBaseUrl,
    els.openaiModel,
    els.apiKey,
    els.youtubeApiKey,
    els.timeoutSec,
    els.maxComments,
    els.redditPerThread,
  ].forEach((el) => {
    el.addEventListener("input", () => {
      if (els.autoSave.checked) saveSettings();
      updateSecurityWarning();
    });
  });
}

function updateVisibility() {
  const p = els.provider.value;
  const isOllama = p === "ollama";
  const isOpenai = p === "openai";
  els.ollamaGroup.classList.toggle("hidden", !isOllama);
  els.openaiGroup.classList.toggle("hidden", !isOpenai);
  // API key is used by the OpenAI-compatible provider (required for OpenRouter,
  // optional for a custom local server).
  els.apiKeyGroup.classList.toggle("hidden", isOllama);
  updateOpenAIUI();
  updateSecurityWarning();
}

// Lock the base URL to OpenRouter when the preset is chosen.
function updateOpenAIUI() {
  const isOpenrouter = els.openaiPreset.value === "openrouter";
  els.openaiBaseUrl.disabled = isOpenrouter;
  if (isOpenrouter) els.openaiBaseUrl.value = OPENROUTER_URL;
}

// Warn if the active provider is a plain-http URL on a non-loopback host (so
// data sent to it isn't encrypted). OpenRouter is https; localhost/127.0.0.1 is
// loopback and fine. Helps the add-on stay within AMO's encryption expectations.
function updateSecurityWarning() {
  const url =
    els.provider.value === "openai"
      ? els.openaiBaseUrl.value.trim()
      : els.provider.value === "ollama"
        ? els.ollamaUrl.value.trim()
        : "";
  const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url);
  const insecure = /^http:\/\//i.test(url) && !isLoopback;
  els.insecureWarn.classList.toggle("hidden", !insecure);
  if (insecure) {
    els.insecureWarn.textContent =
      "Heads-up: this provider is served over plain http, so text sent to it isn't encrypted. Use https or a localhost/loopback URL if that matters.";
  }
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
  // The YouTube site toggle isn't gated on a Data API key: the Gemini hand-off
  // needs no key, so a user can enable YouTube even before adding one.
  const redditOn = isReddit && sites.includes("reddit");
  // Comment/transcript summarization on YouTube still needs the Data API key.
  const youtubeOn = isYoutube && sites.includes("youtube") && hasKey;
  const enabled = redditOn || youtubeOn;

  // "Summarize with Gemini" appears on any enabled YouTube video — it's a
  // hand-off to Gemini in a new tab and needs no Data API key.
  const geminiVisible = isYoutube && sites.includes("youtube");
  els.geminiBtn.classList.toggle("hidden", !geminiVisible);

  els.summarizeBtn.disabled = !enabled;

  if (enabled) {
    els.status.classList.add("hidden");
  } else if (isYoutube && sites.includes("youtube") && !hasKey) {
    setStatus(
      "info",
      "Add a YouTube Data API key in Settings to summarize comments. (The Gemini button works without a key.)",
    );
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
      "openaiPreset",
      "openaiBaseUrl",
      "openaiModel",
      "apiKey",
      "youtubeApiKey",
      "sites",
      "timeoutSec",
      "maxComments",
      "redditPerThread",
    ]);
    els.provider.value = s.provider || DEFAULTS.provider;
    els.ollamaUrl.value = s.ollamaUrl || DEFAULTS.ollamaUrl;
    els.model.value = s.model || DEFAULTS.model;
    els.openaiPreset.value = s.openaiPreset || DEFAULTS.openaiPreset;
    els.openaiBaseUrl.value = s.openaiBaseUrl || DEFAULTS.openaiBaseUrl;
    els.openaiModel.value = s.openaiModel || DEFAULTS.openaiModel;
    // Migrate the old (pre-1.0.6) openrouter/ninfer settings into the unified
    // OpenAI-compatible fields so existing users keep their config.
    if (!s.openaiBaseUrl && s.ninferUrl) els.openaiBaseUrl.value = s.ninferUrl;
    if (!s.openaiModel && (s.openrouterModel || s.ninferModel)) {
      els.openaiModel.value = s.openrouterModel || s.ninferModel;
    }
    if (!s.openaiPreset && s.openrouterModel) els.openaiPreset.value = "openrouter";
    els.apiKey.value = s.apiKey || "";
    els.youtubeApiKey.value = s.youtubeApiKey || "";
    const sites = Array.isArray(s.sites) ? s.sites : ["reddit", "youtube"];
    els.siteReddit.checked = sites.includes("reddit");
    els.siteYoutube.checked = sites.includes("youtube");
    els.timeoutSec.value = s.timeoutSec || DEFAULTS.timeoutSec;
    els.maxComments.value = s.maxComments || DEFAULTS.maxComments;
    els.redditPerThread.value = s.redditPerThread || DEFAULTS.redditPerThread;
  } catch (_) {
    els.ollamaUrl.value = DEFAULTS.ollamaUrl;
    els.model.value = DEFAULTS.model;
    els.openaiPreset.value = DEFAULTS.openaiPreset;
    els.openaiBaseUrl.value = DEFAULTS.openaiBaseUrl;
    els.openaiModel.value = DEFAULTS.openaiModel;
    els.timeoutSec.value = DEFAULTS.timeoutSec;
    els.maxComments.value = DEFAULTS.maxComments;
    els.redditPerThread.value = DEFAULTS.redditPerThread;
  }
  updateVisibility();
}

async function saveSettings() {
  await browser.storage.local.set({
    provider: els.provider.value,
    ollamaUrl: last(els.ollamaUrl.value, DEFAULTS.ollamaUrl),
    model: last(els.model.value, DEFAULTS.model),
    openaiPreset: els.openaiPreset.value,
    openaiBaseUrl: last(els.openaiBaseUrl.value, DEFAULTS.openaiBaseUrl),
    openaiModel: last(els.openaiModel.value, DEFAULTS.openaiModel),
    apiKey: els.apiKey.value.trim(),
    youtubeApiKey: els.youtubeApiKey.value.trim(),
    sites: buildSites(),
    timeoutSec: Number(els.timeoutSec.value) || DEFAULTS.timeoutSec,
    maxComments: Number(els.maxComments.value) || DEFAULTS.maxComments,
    redditPerThread: Number(els.redditPerThread.value) || DEFAULTS.redditPerThread,
  });
}

function buildSites() {
  const sites = [];
  if (els.siteReddit.checked) sites.push("reddit");
  // YouTube is enabled by its checkbox alone (Gemini needs no Data API key);
  // require the key where it's actually needed — the summarize path.
  if (els.siteYoutube.checked) sites.push("youtube");
  return sites;
}

// Manual "Save settings" press: persist, then give immediate visual feedback
// (the button flashes "Saved ✓"). Autosave calls saveSettings() directly and
// doesn't flash, so per-keystroke saves don't get noisy.
async function onManualSave() {
  await saveSettings();
  flashSaved();
}

function flashSaved() {
  const btn = els.saveBtn;
  if (!btn) return;
  btn.textContent = "Saved ✓";
  btn.classList.add("saved");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    btn.textContent = "Save settings";
    btn.classList.remove("saved");
  }, 1500);
}

// --- Models ---

function activeModelInput() {
  const p = els.provider.value;
  if (p === "openai") return els.openaiModel;
  return els.model;
}

async function fetchModels() {
  setStatus("info", "Fetching available models…");
  const provider = els.provider.value;
  let resp;
  try {
    const baseUrl =
      provider === "openai" && els.openaiPreset.value === "openrouter"
        ? OPENROUTER_URL
        : last(els.openaiBaseUrl.value, DEFAULTS.openaiBaseUrl);
    resp = await browser.runtime.sendMessage({
      type: "list-models",
      provider,
      ollamaUrl: last(els.ollamaUrl.value, DEFAULTS.ollamaUrl),
      apiKey: els.apiKey.value.trim(),
      baseUrl,
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
  const frag = document.createDocumentFragment();
  for (const m of models) frag.appendChild(new Option(String(m), String(m)));
  els.modelsList.replaceChildren(frag);
  els.modelsList.classList.remove("hidden");
  setStatus(
    "info",
    `${models.length} model(s) loaded — pick one to fill the model field.`,
  );
}

// --- Updates ---

// Asks the background to compare the installed version against the newest
// GitHub release (force=false reuses a cached answer, force=true always
// re-checks). Shows the banner when a newer release exists; on a manual check
// it also reports "up to date" / errors in the status area.
async function checkForUpdate(force) {
  let resp;
  try {
    resp = await browser.runtime.sendMessage({ type: "check-update", force: !!force });
  } catch (e) {
    if (force) setStatus("err", "Could not check for updates: " + ((e && e.message) || e));
    return;
  }
  if (!resp || !resp.ok) {
    if (force) {
      setStatus(
        "err",
        "Could not check for updates: " + ((resp && resp.error) || "unknown error"),
      );
    }
    return;
  }
  if (!resp.available || !resp.latest) {
    if (force) setStatus("info", resp.message || `You're up to date — version ${resp.current}.`);
    return;
  }

  // A manual "Check for updates" overrides a previous dismissal; the
  // auto-check on popup open respects it (so we don't nag per open).
  if (!force) {
    let dismissed = null;
    try {
      const s = await browser.storage.local.get("updateDismissed");
      dismissed = s && s.updateDismissed;
    } catch (_) {
      /* storage unavailable */
    }
    if (dismissed === resp.latest.version) return;
  }

  lastKnownUpdateVersion = resp.latest.version;
  lastKnownUpdateUrl = resp.latest.url || RELEASES_PAGE;
  els.updateDetail.textContent = `New version ${resp.latest.version} — you're on ${resp.current}.`;
  els.updateBanner.classList.remove("hidden");
  if (force) els.status.classList.add("hidden");
}

async function manualUpdateCheck() {
  setStatus("info", "Checking GitHub for updates…");
  await checkForUpdate(true);
}

function openUpdateUrl() {
  if (lastKnownUpdateUrl) {
    browser.tabs
      .create({ url: lastKnownUpdateUrl, active: true })
      .catch(() => window.open(lastKnownUpdateUrl, "_blank"));
  }
}

function dismissUpdate() {
  els.updateBanner.classList.add("hidden");
  if (lastKnownUpdateVersion) {
    browser.storage.local
      .set({ updateDismissed: lastKnownUpdateVersion })
      .catch(() => {});
  }
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
