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
  ollamaUrl: "http://10.20.10.99:11434",
  model: "qwen3.6:35b-a3b",
  openrouterModel: "openai/gpt-4o-mini",
  ninferUrl: "http://127.0.0.1:8000/v1",
  ninferModel: "qwen3.6-27b-ninfer",
  timeoutSec: 180,
};

// The content script opens a long-lived port (name "summarize") and posts the
// request here. We run it and stream the result back over the SAME port. A port
// is more robust than tabs.sendMessage for long-running requests — it stays
// open regardless of the popup, and needs no extra host permission to reply.
api.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== "summarize") return;

  port.onMessage.addListener((message) => {
    if (!message || message.type !== "summarize") return;
    handleSummarize(message)
      .then((summary) => {
        try {
          port.postMessage({ ok: true, summary });
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

// The popup asks for the list of available models from the active provider.
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

  // OpenAI-compatible (OpenRouter / ninfer)
  const baseUrl = (
    message.baseUrl ||
    message.ninferUrl ||
    (provider === "openrouter"
      ? "https://openrouter.ai/api/v1"
      : DEFAULTS.ninferUrl)
  ).replace(/\/+$/, "");
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

async function handleSummarize(message) {
  const provider = message.provider || "ollama";
  const timeoutSec = Number(message.timeoutSec) || DEFAULTS.timeoutSec;
  const system = message.system;
  const user = message.user;

  if (provider === "openrouter") {
    return callOpenAICompatible(
      message.baseUrl || "https://openrouter.ai/api/v1",
      message.apiKey,
      message.model || message.openrouterModel || DEFAULTS.openrouterModel,
      system,
      user,
      timeoutSec,
      true, // require key
    );
  }

  if (provider === "ninfer") {
    return callOpenAICompatible(
      message.baseUrl || message.ninferUrl || DEFAULTS.ninferUrl,
      message.apiKey,
      message.model || message.ninferModel || DEFAULTS.ninferModel,
      system,
      user,
      timeoutSec,
      false, // key optional on a local network server
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
