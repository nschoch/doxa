// Background worker for Doxa.
// Receives a summarization request (from the page's content script) and calls
// the chosen provider: a local Ollama server, or an OpenAI-compatible API
// (OpenRouter, or a local ninfer server). The request runs in the extension
// context with a configurable timeout (AbortController), so it keeps running
// even if the popup closes.

const api =
  typeof browser !== "undefined"
    ? browser
    : typeof chrome !== "undefined"
      ? chrome
      : null;

const DEFAULTS = {
  ollamaUrl: "http://localhost:11434",
  model: "qwen3.6:35b-a3b",
  openaiBaseUrl: "http://localhost:8000/v1",
  openaiModel: "qwen3.6-27b-ninfer",
  timeoutSec: 180,
};

// The content script opens a long-lived port (name "summarize") and posts the
// request here. We run it and stream the result back over the SAME port. A port
// is more robust than tabs.sendMessage for long-running requests — it stays
// open regardless of the popup, and needs no extra host permission to reply.
api.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== "summarize") return;

  port.onMessage.addListener((message) => {
    if (!message) return;
    let task = null;
    if (message.type === "summarize") {
      task = handleSummarize(message).then((summary) => ({ ok: true, summary }));
    } else if (message.type === "youtube-comments") {
      task = dataApiComments(
        message.apiKey,
        message.videoId,
        Number(message.maxResults) || 300,
      ).then((comments) => ({ ok: true, comments }));
    }
    if (!task) return;
    task
      .then((result) => {
        try {
          port.postMessage(result);
        } catch (_) {
          /* port closed */
        }
      })
      .catch((err) => {
        try {
          port.postMessage({
            ok: false,
            error: err && err.message ? err.message : String(err),
          });
        } catch (_) {
          /* port closed */
        }
      });
  });
});

// The popup asks for the list of available models from the active provider, or
// asks whether a new version has been published on GitHub.
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "list-models") {
    listModels(message)
      .then((models) => sendResponse({ ok: true, models }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err && err.message ? err.message : String(err),
        }),
      );
    return true; // async response
  }
  if (message && message.type === "check-update") {
    checkForUpdate(Boolean(message.force))
      .then((res) => sendResponse(res))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err && err.message ? err.message : String(err),
        }),
      );
    return true; // async response
  }
});

async function listModels(message) {
  const provider = message.provider || "ollama";
  const timeoutSec = Math.min(Number(message.timeoutSec) || 30, 60);

  if (provider === "ollama") {
    const url = (message.ollamaUrl || DEFAULTS.ollamaUrl).replace(/\/+$/, "");
    const res = await fetchWithTimeout(`${url}/api/tags`, {}, timeoutSec);
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const data = await res.json();
    const models = (data.models || [])
      .map((m) => m.name || m.model)
      .filter(Boolean)
      .sort();
    if (!models.length) throw new Error("No models found on the Ollama server.");
    return models;
  }

  // OpenAI-compatible (OpenRouter or a custom local server)
  const baseUrl = (message.baseUrl || DEFAULTS.openaiBaseUrl).replace(/\/+$/, "");
  const headers = {};
  if (message.apiKey) headers.Authorization = `Bearer ${message.apiKey}`;
  const res = await fetchWithTimeout(`${baseUrl}/models`, { headers }, timeoutSec);
  if (!res.ok) throw new Error(`API returned ${res.status}`);
  const data = await res.json();
  const models = (data.data || [])
    .map((m) => m.id)
    .filter(Boolean)
    .sort();
  if (!models.length) throw new Error("No models returned by the API.");
  return models;
}

// Fetches comments via the YouTube Data API v3 (this runs in the extension
// context, so cross-origin/CORS is handled by the extension host permission).
// Returns an array of comment strings (top-level comments + included replies).
async function dataApiComments(apiKey, videoId, limit) {
  if (!apiKey) throw new Error("YouTube Data API key is not set.");
  if (!videoId) throw new Error("Could not determine the video id.");
  const texts = [];
  let pageToken = "";
  let fetched = 0;
  let pages = 0;
  while (fetched < limit && pages < 8) {
    const url =
      "https://www.googleapis.com/youtube/v3/commentThreads" +
      `?part=snippet,replies&videoId=${encodeURIComponent(videoId)}` +
      `&maxResults=${Math.min(100, limit - fetched) || 100}` +
      `&textFormat=plainText` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "") +
      `&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(
        "YouTube Data API " +
          res.status +
          (res.status === 403 ? " (key invalid or quota exceeded)" : "") +
          " " +
          msg.slice(0, 120),
      );
    }
    const data = await res.json();
    const items = data.items || [];
    for (const it of items) {
      const top =
        it.snippet && it.snippet.topLevelComment && it.snippet.topLevelComment.snippet;
      if (top && top.textDisplay) {
        texts.push(top.textDisplay.trim());
        fetched++;
      }
      const reps = it.replies && it.replies.comments;
      if (reps) {
        for (const r of reps) {
          if (r.snippet && r.snippet.textDisplay) {
            texts.push(r.snippet.textDisplay.trim());
            fetched++;
          }
        }
      }
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
    pages++;
  }
  return texts;
}

async function handleSummarize(message) {
  const provider = message.provider || "ollama";
  const timeoutSec = Number(message.timeoutSec) || DEFAULTS.timeoutSec;

  if (provider !== "ollama") {
    // One OpenAI-compatible path for OpenRouter *and* any custom local server.
    const baseUrl = (message.baseUrl || DEFAULTS.openaiBaseUrl).replace(/\/+$/, "");
    return callOpenAICompatible(
      baseUrl,
      message.apiKey,
      message.model || message.openaiModel || DEFAULTS.openaiModel,
      message.system,
      message.user,
      timeoutSec,
      !!message.requireKey, // required for OpenRouter; optional for a local server
    );
  }

  return callOllama(message, timeoutSec);
}

// Wraps fetch with a hard timeout that aborts on expiry.
function fetchWithTimeout(url, options, timeoutSec) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutSec * 1000);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() =>
    clearTimeout(timer),
  );
}

// --- Local Ollama ---
async function callOllama(message, timeoutSec) {
  const url = message.ollamaUrl || DEFAULTS.ollamaUrl;
  const model = message.model || DEFAULTS.model;
  const payload = {
    model,
    stream: false,
    options: { temperature: 0.6 },
    messages: [
      { role: "system", content: message.system },
      { role: "user", content: message.user },
    ],
  };

  let res;
  try {
    res = await fetchWithTimeout(
      `${url}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      timeoutSec,
    );
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error(`The request timed out after ${timeoutSec}s.`);
    }
    throw new Error(
      `Could not reach Ollama at ${url}. Is it running? (${err.message})`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama returned ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data && data.message && data.message.content) || "";
  if (!text) throw new Error("Ollama returned an empty response.");
  return text;
}

// --- OpenAI-compatible API (OpenRouter / ninfer) ---
function chatCompletionsUrl(baseUrl) {
  const b = String(baseUrl || "").trim().replace(/\/+$/, "");
  return b.endsWith("/chat/completions") ? b : `${b}/chat/completions`;
}

async function callOpenAICompatible(
  baseUrl,
  apiKey,
  model,
  system,
  user,
  timeoutSec,
  requireKey,
) {
  if (requireKey && !apiKey) {
    throw new Error("API key is not set. Add it in the extension settings.");
  }

  const payload = {
    model,
    stream: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let res;
  try {
    res = await fetchWithTimeout(
      chatCompletionsUrl(baseUrl),
      { method: "POST", headers, body: JSON.stringify(payload) },
      timeoutSec,
    );
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error(`The request timed out after ${timeoutSec}s.`);
    }
    throw new Error(`Could not reach the API at ${baseUrl}. (${err.message})`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API returned ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text =
    (data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content) ||
    "";
  if (!text) throw new Error("The API returned an empty response.");
  return text;
}

// --- Update checking (GitHub Releases) ---
// Doxa isn't distributed through an auto-updating store, so it can't install
// updates itself. Instead it checks GitHub for the newest published release
// and reports it to the popup, which shows an "Update available" banner with a
// link to the release page (the user downloads/rebuilds from there). Results
// are cached in storage so we don't hammer the GitHub API (unauthenticated
// limit is 60 requests/hour per IP).

const GITHUB_REPO = "nschoch/doxa";
const GITHUB_API_LATEST = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const UPDATE_CACHE_KEY = "updateCheck";
const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // re-check at most every 6h
const UPDATE_FETCH_TIMEOUT_S = 20;

// "v0.5.0", "0.4.0-beta1", … → [0, 5, 0]. Returns null when not a version.
function parseVersion(v) {
  const m = String(v || "")
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
  if (!m) return null;
  return [Number(m[1]) || 0, Number(m[2]) || 0, Number(m[3]) || 0];
}

// Returns > 0 when a is newer than b (numeric compare; -beta/+build suffixes
// are ignored — GitHub's "latest" endpoint excludes pre-releases anyway).
function cmpVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return String(a || "").localeCompare(String(b || ""));
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// Resolves to { ok, current, available, latest, message, checkedAt }.
// - force=false: reuse a cached answer younger than the TTL, else fetch.
// - force=true:  always hit the GitHub API.
// A fresh fetch result (and only that) is written to the storage cache, so a
// failed/offline check isn't cached and will retry on the next popup open.
async function checkForUpdate(force) {
  const current =
    (api.runtime.getManifest() && api.runtime.getManifest().version) || "0.0.0";
  try {
    const stored = await api.storage.local.get(UPDATE_CACHE_KEY);
    const cache = stored[UPDATE_CACHE_KEY] || null;
    if (
      !force &&
      cache &&
      cache.checkedAt &&
      Date.now() - cache.checkedAt < UPDATE_CACHE_TTL_MS
    ) {
      return {
        ok: true,
        cached: true,
        current,
        available: !!cache.available,
        latest: cache.latest || null,
        message: cache.message || null,
        checkedAt: cache.checkedAt,
      };
    }

    let res;
    try {
      res = await fetchWithTimeout(
        GITHUB_API_LATEST,
        { headers: { Accept: "application/vnd.github+json" } },
        UPDATE_FETCH_TIMEOUT_S,
      );
    } catch (err) {
      throw new Error(`Could not reach GitHub (${err.message}).`);
    }
    const data = await res.json().catch(() => ({}));

    const record = { checkedAt: Date.now() };
    if (res.status === 404) {
      // Repo exists but has never published a release.
      record.available = false;
      record.latest = null;
      record.message = "No releases published on GitHub yet.";
    } else if (!res.ok) {
      record.available = false;
      record.latest = null;
      record.message = `GitHub check failed (HTTP ${res.status}${
        data && data.message ? ": " + data.message : ""
      }).`;
    } else {
      const tag = String((data && (data.tag_name || data.name)) || "").trim();
      const latest = {
        version: tag.replace(/^v/i, ""),
        tag,
        name: (data && data.name) || tag,
        url: (data && data.html_url) || `https://github.com/${GITHUB_REPO}/releases`,
      };
      record.available = !!latest.version && cmpVersions(latest.version, current) > 0;
      record.latest = latest;
      record.message = null;
    }
    await api.storage.local.set({ [UPDATE_CACHE_KEY]: record });

    return {
      ok: true,
      cached: false,
      current,
      available: !!record.available,
      latest: record.latest || null,
      message: record.message || null,
      checkedAt: record.checkedAt,
    };
  } catch (err) {
    return { ok: false, current, error: (err && err.message) || String(err) };
  }
}
