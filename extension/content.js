// Content script for Doxa.
// Injected into Reddit and YouTube pages. It:
//   - collects loaded comments (Reddit/YouTube), auto-scrolling YouTube first,
//   - extracts a YouTube video's transcript (captions),
//   - shows an on-page card that renders the summary as formatted Markdown,
//   - lets the user ask a follow-up question (grounded in the same source),
//   - proxies requests to the background worker over a long-lived port.

(() => {
  "use strict";

  const SYSTEM_PROMPT = [
    "You are a precise assistant that summarizes comment sections.",
    "Write a concise, well-structured summary in Markdown.",
    "Capture the overall consensus, the main points, and where people disagree.",
    "Include notable or frequently-repeated comments and any clear 'camps'.",
    "Be neutral, do not invent details, and stay under ~250 words.",
  ].join(" ");

  const TRANSCRIPT_SYSTEM_PROMPT = [
    "You are a precise assistant that summarizes video transcripts.",
    "Write a concise, well-structured summary in Markdown.",
    "Capture the key points, important details, and any actions or conclusions.",
    "Be neutral, do not invent details, and stay under ~300 words.",
  ].join(" ");

  const FOLLOWUP_SYSTEM_PROMPT = [
    "You are answering a follow-up question about content that was already summarized.",
    "Answer using ONLY the provided content. Do not invent facts.",
    "Be concise, direct, and use Markdown for structure if helpful.",
  ].join(" ");

  // --- state ---
  let _meta = { countLabel: "", model: "" };
  let _lastContext = null; // { kind: 'comments'|'transcript', text, host }
  let _lastSummary = "";
  let _cached = null; // last result for this page load, so repeat clicks reuse it
  let _currentAction = "comments"; // 'comments' | 'transcript'
  // Resets on each page load -> a refresh invalidates the cache (per user request).
  let _pageNonce = performance && performance.timeOrigin ? performance.timeOrigin : Date.now();

  // Cache key: page + source type + provider/model + max, so a repeat click on the
  // same page reuses the result, but changing provider/model or refreshing doesn't.
  function makeKey(kind, provider, model, max) {
    return (
      location.origin +
      location.pathname +
      location.search +
      "|" +
      kind +
      "|" +
      provider +
      "|" +
      model +
      "|" +
      (Number(max) || 300) +
      "|" +
      _pageNonce
    );
  }

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "collect") {
      const comments = collectComments();
      sendResponse({ ok: true, host: location.host, count: comments.length, comments });
      return;
    }
    if (message && message.type === "start") {
      startSummary();
      sendResponse({ ok: true });
      return;
    }
    if (message && message.type === "start-transcript") {
      startTranscript();
      sendResponse({ ok: true });
      return;
    }
    if (message && message.type === "preview") {
      previewComments();
      sendResponse({ ok: true });
      return;
    }
    if (message && message.type === "ping") {
      sendResponse({ ok: true, host: location.host });
      return;
    }
  });

  function getSettings() {
    return browser.storage.local.get([
      "provider",
      "model",
      "openrouterModel",
      "ninferModel",
      "ollamaUrl",
      "ninferUrl",
      "apiKey",
      "youtubeApiKey",
      "sites",
      "timeoutSec",
      "maxComments",
    ]);
  }

  function isSiteEnabled(s) {
    const host = location.host;
    const sites = Array.isArray(s.sites) ? s.sites : ["reddit", "youtube"];
    if (host.includes("reddit.com")) return sites.includes("reddit");
    if (host.includes("youtube.com")) return sites.includes("youtube");
    return false;
  }

  function getVideoId() {
    try {
      return new URL(location.href).searchParams.get("v") || "";
    } catch (_) {
      return "";
    }
  }

  // Fetches comments via the YouTube Data API v3 (reliable; not blocked by
  // closed shadow DOM / lazy loading). Requires a YouTube Data API key.
  // On YouTube: prefer the Data API (fetched via the background port, so CORS is
  // handled); otherwise fall back to auto-scroll DOM scraping.
  async function getYoutubeComments(s, onProgress) {
    const videoId = getVideoId();
    if (s.youtubeApiKey && videoId) {
      try {
        const r = await fetchCommentsViaBackground(
          s.youtubeApiKey,
          videoId,
          Number(s.maxComments) || 300,
        );
        if (r && r.ok && r.comments && r.comments.length) return r.comments;
      } catch (_) {
        /* fall through to DOM scraping */
      }
    }
    return ensureYoutubeComments(Number(s.maxComments) || 300, 25, onProgress);
  }

  function resolveModel(provider, s) {
    if (provider === "openrouter") return s.openrouterModel || "openai/gpt-4o-mini";
    if (provider === "ninfer") return s.ninferModel || "qwen3.6-27b-ninfer";
    return s.model || "qwen3.6:35b-a3b";
  }

  // Runs a request over the long-lived "summarize" port; resolves with the first
  // message the background sends back.
  function portRequest(payload) {
    return new Promise((resolve) => {
      let port;
      let settled = false;
      try {
        port = browser.runtime.connect({ name: "summarize" });
      } catch (e) {
        resolve({ ok: false, error: String((e && e.message) || e) });
        return;
      }
      port.onMessage.addListener((msg) => {
        settled = true;
        try {
          port.disconnect();
        } catch (_) {}
        resolve(msg || { ok: false, error: "No response." });
      });
      port.onDisconnect.addListener(() => {
        if (!settled) {
          resolve({
            ok: false,
            error: "The background connection closed before a result arrived.",
          });
        }
      });
      try {
        port.postMessage(payload);
      } catch (e) {
        resolve({ ok: false, error: String((e && e.message) || e) });
      }
    });
  }

  function requestSummary(cfg) {
    return portRequest({
      type: "summarize",
      provider: cfg.provider,
      system: cfg.system,
      user: cfg.user,
      model: cfg.model,
      ollamaUrl: cfg.ollamaUrl,
      apiKey: cfg.apiKey,
      ninferUrl: cfg.ninferUrl,
      timeoutSec: cfg.timeoutSec,
    });
  }

  function fetchCommentsViaBackground(apiKey, videoId, maxResults) {
    return portRequest({
      type: "youtube-comments",
      apiKey,
      videoId,
      maxResults,
    });
  }

  // Shows an elapsed-seconds counter in the card while a request is running.
  function startTicker(card, baseMsg) {
    const t0 = Date.now();
    let last = "";
    const timer = setInterval(() => {
      const n = Math.round((Date.now() - t0) / 1000);
      const label = `${baseMsg} ${n}s`;
      if (label !== last) {
        last = label;
        card.status(label, "pending");
      }
    }, 1000);
    return () => clearInterval(timer);
  }

  // --- comments summary ---
  // Drops the cached result and re-runs the current action (comments/transcript).
  function regenerate() {
    _cached = null;
    if (_currentAction === "transcript") startTranscript();
    else startSummary();
  }

  async function previewComments() {
    const card = ensureCard();
    card.status("Reading comments…", "pending");
    const s = await getSettings();
    const isYoutube = location.host.includes("youtube.com");
    if (!isSiteEnabled(s)) {
      card.status("This site isn't enabled in Settings. Enable it under Settings → Sites.", "error");
      return;
    }
    if (isYoutube && !s.youtubeApiKey) {
      card.status("Add a YouTube Data API key in Settings to read comments on YouTube.", "error");
      return;
    }
    let comments;
    if (isYoutube) {
      comments = await getYoutubeComments(s);
    } else {
      comments = collectComments();
    }
    if (!comments.length) {
      card.status("No comments found on this page.", "error");
      return;
    }
    const text = comments
      .slice(0, 60)
      .map((c, i) => `${i + 1}. ${c}`)
      .join("\n\n");
    card.list(`Extracted ${comments.length} comment(s). Does this match the page?`, text);
  }

  async function startSummary() {
    const card = ensureCard();
    const s = await getSettings();
    const isYoutube = location.host.includes("youtube.com");
    if (!isSiteEnabled(s)) {
      card.status("This site isn't enabled in Settings. Enable it under Settings → Sites.", "error");
      return;
    }
    if (isYoutube && !s.youtubeApiKey) {
      card.status("Add a YouTube Data API key in Settings to summarize comments on YouTube.", "error");
      return;
    }

    let comments;
    if (isYoutube) {
      card.status("Loading comments…", "pending");
      comments = await getYoutubeComments(s, (count) =>
        card.status(
          count > 0 ? `Loading comments… ${count} loaded` : "Loading comments… (auto-scroll)",
          "pending",
        ),
      );
    } else {
      comments = collectComments();
    }

    if (!comments.length) {
      card.status(
        "No comments found. On YouTube, scroll down to load comments first, then click Summarize again.",
        "error",
      );
      return;
    }

    const slice = comments.slice(0, Number(s.maxComments) || 300);
    const provider = s.provider || "ollama";
    const model = resolveModel(provider, s);
    const key = makeKey("comments", provider, model, s.maxComments);

    // If we already summarized this exact page/content this page-load, reuse it.
    if (_cached && _cached.key === key) {
      _meta = { countLabel: _cached.count, model };
      _lastContext = _cached.context;
      _lastSummary = _cached.summary;
      _currentAction = "comments";
      card.result(_cached.summary, _cached.count, model);
      return;
    }

    _meta = { countLabel: `${slice.length} comment(s)`, model };
    _lastContext = { kind: "comments", text: slice.join("\n\n"), host: location.host };
    _currentAction = "comments";

    card.status(`Summarizing ${slice.length} comment(s) with ${model}…`, "pending");
    const stopTicker = startTicker(card, `Summarizing ${slice.length} comment(s) with ${model}`);

    const r = await requestSummary({
      provider,
      system: SYSTEM_PROMPT,
      user: buildPrompt(slice, location.host),
      model,
      ollamaUrl: s.ollamaUrl,
      apiKey: s.apiKey,
      ninferUrl: s.ninferUrl,
      timeoutSec: s.timeoutSec,
    });
    stopTicker();

    if (r && r.ok) {
      _lastSummary = r.summary;
      _cached = { key, summary: r.summary, count: _meta.countLabel, model, context: _lastContext };
      card.result(r.summary, _meta.countLabel, model);
    } else {
      card.status("Error: " + ((r && r.error) || "Summarization failed."), "error");
    }
  }

  // --- YouTube transcript summary ---
  async function startTranscript() {
    const card = ensureCard();
    if (!location.host.includes("youtube.com")) {
      card.status("Transcript summarization works on YouTube videos.", "error");
      return;
    }
    const s = await getSettings();
    if (!isSiteEnabled(s)) {
      card.status("YouTube isn't enabled in Settings. Enable it under Settings → Sites.", "error");
      return;
    }
    if (!s.youtubeApiKey) {
      card.status("Add a YouTube Data API key in Settings to summarize a video.", "error");
      return;
    }
    card.status("Loading transcript…", "pending");
    try {
      const text = await getTranscript();
      if (!text || text.length < 20) {
        card.status("No transcript found for this video.", "error");
        return;
      }
      const provider = s.provider || "ollama";
      const model = resolveModel(provider, s);
      const key = makeKey("transcript", provider, model, s.maxComments);

      // Reuse a cached summary for this video/provider/model this page load.
      if (_cached && _cached.key === key) {
        _meta = { countLabel: _cached.count, model };
        _lastContext = _cached.context;
        _lastSummary = _cached.summary;
        _currentAction = "transcript";
        card.result(_cached.summary, _cached.count, model);
        return;
      }

      _meta = { countLabel: "Video", model };
      _lastContext = { kind: "transcript", text, host: location.host };
      _currentAction = "transcript";

      card.status(`Summarizing video with ${model}…`, "pending");
      const stopTicker = startTicker(card, `Summarizing video with ${model}`);
      const r = await requestSummary({
        provider,
        system: TRANSCRIPT_SYSTEM_PROMPT,
        user: buildTranscriptPrompt(text),
        model,
        ollamaUrl: s.ollamaUrl,
        apiKey: s.apiKey,
        ninferUrl: s.ninferUrl,
        timeoutSec: s.timeoutSec,
      });
      stopTicker();

      if (r && r.ok) {
        _lastSummary = r.summary;
        _cached = { key, summary: r.summary, count: _meta.countLabel, model, context: _lastContext };
        card.result(r.summary, _meta.countLabel, model);
      } else {
        card.status("Error: " + ((r && r.error) || "Summarization failed."), "error");
      }
    } catch (e) {
      card.status("Error: " + ((e && e.message) || String(e)), "error");
    }
  }

  // --- follow-up ---
  async function askFollowup() {
    const card = ensureCard();
    const input = cardEl.querySelector(".cs-ask-input");
    const q = ((input && input.value) || "").trim();
    if (!q) return;
    if (!_lastContext) {
      card.renderFollowupError("Nothing to ask about yet. Summarize a page first.");
      return;
    }
    card.askPending();
    const s = await getSettings();
    const provider = s.provider || "ollama";
    const model = resolveModel(provider, s);
    const user = buildFollowupPrompt(_lastContext.text, _lastSummary, q);
    try {
      const r = await requestSummary({
        provider,
        system: FOLLOWUP_SYSTEM_PROMPT,
        user,
        model,
        ollamaUrl: s.ollamaUrl,
        apiKey: s.apiKey,
        ninferUrl: s.ninferUrl,
        timeoutSec: s.timeoutSec,
      });
      if (r && r.ok) card.renderFollowup(r.summary);
      else card.renderFollowupError("Error: " + ((r && r.error) || "Failed."));
    } catch (e) {
      card.renderFollowupError("Error: " + ((e && e.message) || String(e)));
    }
    card.askDone();
  }

  function buildPrompt(comments, host) {
    const numbered = comments.map((c, i) => `${i + 1}. ${c}`).join("\n");
    return [
      `Please summarize the comments from a page on ${host}.`,
      "",
      "Write the summary in the SAME language as most of the comments (use English if mixed).",
      "",
      "Use this structure:",
      "### TL;DR",
      "- One or two sentences on what the discussion is about.",
      "### Main points",
      "- 3-6 bullets on the most common or important points.",
      "### Consensus vs. disagreement",
      "- What most commenters agree on, and what splits them into camps.",
      "### Notable comments",
      "- Only if there's a standout clever, funny, or important comment.",
      "",
      "Comments:",
      numbered,
    ].join("\n");
  }

  function buildTranscriptPrompt(text) {
    const capped = text.length > 120000 ? text.slice(0, 120000) + "\n…(truncated)" : text;
    return [
      "Please summarize the following video transcript.",
      "",
      "Use this structure:",
      "### TL;DR",
      "- One or two sentences on what the video is about.",
      "### Key points",
      "- 4-8 bullets on the main ideas, details, or conclusions.",
      "### Actions / takeaways",
      "- Only if the video recommends steps or decisions.",
      "",
      "Transcript:",
      capped,
    ].join("\n");
  }

  function buildFollowupPrompt(sourceText, summary, question) {
    const capped =
      sourceText.length > 120000 ? sourceText.slice(0, 120000) + "\n…(truncated)" : sourceText;
    return [
      "Here is the source content that was summarized:",
      "----",
      capped,
      "----",
      summary ? "Here is the summary that was produced:\n" + summary + "\n----" : "",
      `Question: ${question}`,
      "",
      "Answer the question based only on the source content above.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // --- YouTube transcript extraction ---
  async function getTranscript() {
    const pr = extractPlayerResponse();
    const tracks =
      pr &&
      pr.captions &&
      pr.captions.playerCaptionsTracklistRenderer &&
      pr.captions.playerCaptionsTracklistRenderer.captionTracks;
    if (!tracks || !tracks.length) {
      throw new Error("No captions/transcript available for this video.");
    }
    const track =
      tracks.find((t) => (t.languageCode || "").toLowerCase().startsWith("en")) ||
      tracks[0];
    const baseUrl = track.baseUrl;
    if (!baseUrl) throw new Error("Captions URL not found for this video.");

    const url = baseUrl + (baseUrl.includes("fmt=") ? "" : "&fmt=json3");
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not fetch the transcript (HTTP " + res.status + ").");
    const data = await res.json();

    let text = "";
    if (data && Array.isArray(data.events)) {
      for (const ev of data.events) {
        if (ev && Array.isArray(ev.segs)) {
          for (const seg of ev.segs) {
            if (seg && seg.utf8) text += seg.utf8;
          }
        }
      }
    }
    return text.trim();
  }

  // Reads the page's ytInitialPlayerResponse (from a <script> tag or window) to
  // find caption tracks. Robust across browsers / content-script isolation.
  function extractPlayerResponse() {
    return getPageVar("ytInitialPlayerResponse");
  }

  // --- comment extraction ---
  function collectComments() {
    const host = location.host;
    if (host.includes("reddit.com")) return extractRedditComments();
    if (host.includes("youtube.com")) return extractYoutubeComments();
    return [];
  }

  function dedupe(list) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const t = String(item).trim();
      if (t && t.length > 3 && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out;
  }

  function extractRedditComments() {
    const seen = new Set();

    const shreddit = document.querySelectorAll("shreddit-comment");
    if (shreddit.length) {
      const out = [];
      for (const node of shreddit) {
        const body = node.querySelector('div[slot="comment"]') || node;
        let t = (body.innerText || body.textContent || "").trim();
        t = t
          .replace(/\bExpand\b/g, "")
          .replace(/\bMore replies\b/g, "")
          .replace(/\bShare\b/g, "")
          .replace(/\bSave\b/g, "")
          .replace(/\bReport\b/g, "")
          .trim();
        if (t && t.length > 3 && !seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
      if (out.length) return out;
    }

    const dt = document.querySelectorAll('[data-testid="comment"]');
    if (dt.length) {
      const out = [];
      for (const node of dt) {
        const body = node.querySelector("div[slot='comment'], .md, p") || node;
        const t = (body.innerText || body.textContent || "").trim();
        if (t && t.length > 3 && !seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
      if (out.length) return out;
    }

    const old = document.querySelectorAll(
      ".commentarea .comment .entry .md, .commentarea .comment > .entry",
    );
    const out = [];
    for (const node of old) {
      const t = (node.innerText || node.textContent || "").trim();
      if (t && t.length > 3 && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out;
  }

  // YouTube renders its comment components inside (open) shadow roots, which a
  // normal document.querySelectorAll won't reach. Walk into shadow roots to find
  // the comment hosts.
  function allShadowMatches(selector) {
    const found = [];
    const walk = (r) => {
      if (!r || !r.querySelectorAll) return;
      try {
        found.push(...r.querySelectorAll(selector));
      } catch (_) {}
      let all = [];
      try {
        all = r.querySelectorAll("*");
      } catch (_) {}
      for (const el of all) {
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return found;
  }

  function commentText(node) {
    const stack = [node];
    const seen = new Set();
    while (stack.length) {
      const n = stack.pop();
      if (!n || seen.has(n)) continue;
      seen.add(n);
      try {
        const el = n.querySelector && n.querySelector("#content-text");
        if (el) {
          const t = (el.innerText || el.textContent || "").trim();
          if (t) return t;
        }
      } catch (_) {}
      if (n.shadowRoot) stack.push(n.shadowRoot);
      const kids = n.querySelectorAll ? n.querySelectorAll("*") : [];
      for (const k of kids) if (k.shadowRoot) stack.push(k.shadowRoot);
    }
    return "";
  }

  function extractYoutubeComments() {
    // 1) Try DOM (works if the comment shadow roots are open/accessible).
    const seen = new Set();
    const out = [];
    for (const node of allShadowMatches("ytd-comment-renderer")) {
      const t = commentText(node);
      if (t && t.length > 3 && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    if (out.length) return dedupe(out);

    // 2) Fallback: parse the embedded ytInitialData JSON (DOM-independent; works
    //    even when YouTube uses closed shadow roots).
    return collectCommentsFromInitialData();
  }

  // Parses a page-global JSON variable (e.g. ytInitialData / ytInitialPlayerResponse)
  // from window or a <script> tag, robust to nested braces/strings.
  function getPageVar(name) {
    try {
      if (window[name]) return window[name];
    } catch (_) {}
    const scripts = document.querySelectorAll("script");
    for (const s of scripts) {
      const t = s.textContent || "";
      for (const pat of [`${name} =`, `var ${name} =`, `window.${name} =`]) {
        const idx = t.indexOf(pat);
        if (idx === -1) continue;
        const start = t.indexOf("{", idx);
        if (start === -1) continue;
        let depth = 0;
        let inStr = false;
        let esc = false;
        let i = start;
        for (; i < t.length; i++) {
          const ch = t[i];
          if (inStr) {
            if (esc) esc = false;
            else if (ch === "\\") esc = true;
            else if (ch === '"') inStr = false;
            continue;
          }
          if (ch === '"') inStr = true;
          else if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
        }
        try {
          return JSON.parse(t.slice(start, i));
        } catch (_) {}
      }
    }
    return null;
  }

  function runsToText(contentText) {
    if (!contentText) return "";
    if (typeof contentText === "string") return contentText;
    if (contentText.simpleText) return contentText.simpleText;
    if (Array.isArray(contentText.runs)) {
      return contentText.runs.map((r) => (r && r.text) || "").join("");
    }
    return "";
  }

  // Walks the whole ytInitialData object and collects comment body text.
  function collectCommentsFromInitialData() {
    const data = getPageVar("ytInitialData");
    if (!data) return [];
    const texts = [];
    const stack = [data];
    const seen = new Set();
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n !== "object") continue;
      if (seen.has(n)) continue;
      seen.add(n);
      if (Array.isArray(n)) {
        for (const x of n) stack.push(x);
        continue;
      }
      // A commentRenderer holds the comment body in .contentText.
      if (n.commentRenderer && n.commentRenderer.contentText) {
        const t = runsToText(n.commentRenderer.contentText).trim();
        if (t) texts.push(t);
      }
      for (const k of Object.keys(n)) stack.push(n[k]);
    }
    return dedupe(texts);
  }

  // --- YouTube auto-scroll ---
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function countComments() {
    return allShadowMatches("ytd-comment-renderer").length;
  }

  function expandReplies() {
    document
      .querySelectorAll(
        "ytd-comment-replies-renderer #more-replies, #expander, ytd-comment-thread-renderer #more-replies",
      )
      .forEach((el) => {
        try {
          el.click();
        } catch (_) {}
      });
    document.querySelectorAll("ytd-button-renderer").forEach((b) => {
      const t = (b.textContent || "").toLowerCase();
      if (t.includes("show more") || t.includes("load more")) {
        try {
          b.click();
        } catch (_) {}
      }
    });
  }

  function scrollComments() {
    const c = document.querySelector("ytd-comments") || document.querySelector("#comments");
    if (c) {
      try {
        c.scrollIntoView({ block: "start", behavior: "smooth" });
      } catch (_) {}
      try {
        c.scrollTop = c.scrollHeight;
      } catch (_) {}
    }
    try {
      window.scrollBy(0, Math.round(window.innerHeight * 0.8));
    } catch (_) {}
    try {
      window.scrollTo(0, document.body.scrollHeight);
    } catch (_) {}
  }

  async function findCommentsSection(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (
        document.querySelector("ytd-comments, #comments, ytd-comment-thread-renderer")
      ) {
        return true;
      }
      try {
        window.scrollBy(0, 700);
      } catch (_) {}
      await sleep(350);
    }
    return false;
  }

  async function ensureYoutubeComments(target, maxScrolls, onProgress) {
    // Wait for the comments section to render on the page before collecting.
    await findCommentsSection(8000);
    let last = countComments();
    let stable = 0;
    for (let i = 0; i < maxScrolls; i++) {
      expandReplies();
      scrollComments();
      await sleep(1300);
      const c = countComments();
      if (onProgress) onProgress(c);
      if (c === last) {
        stable++;
        if (stable >= 4) break;
      } else {
        stable = 0;
        last = c;
        if (c >= target) break;
      }
    }
    return collectComments();
  }

  // --- on-page summary card ---
  let cardEl = null;
  let styleInjected = false;

  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    const style = document.createElement("style");
    style.textContent = `
      #cs-card { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
        width: 380px; max-width: calc(100vw - 32px); max-height: 75vh; display: flex; flex-direction: column;
        background: #ffffff; color: #1f2328; border: 1px solid #d0d7de; border-radius: 10px;
        box-shadow: 0 8px 30px rgba(0,0,0,.25); font: 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
      #cs-card * { box-sizing: border-box; }
      #cs-card .cs-header { display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px; border-bottom: 1px solid #d0d7de; font-weight: 600; }
      #cs-card .cs-header span { flex: 1; min-width: 0; line-height: 1.25; }
      #cs-card .cs-close { flex: none; border: none; background: none; font-size: 18px; line-height: 1; cursor: pointer; color: #6a737d; margin-left: 8px; }
      #cs-card .cs-body { padding: 12px; overflow: auto; max-height: 58vh; }
      #cs-card .cs-status { white-space: pre-wrap; }
      #cs-card .cs-status.pending { color: #1e40af; }
      #cs-card .cs-status.error { color: #dc2626; }
      #cs-card .cs-result { font-size: 13px; line-height: 1.5; }
      #cs-card .cs-meta { color: #6a737d; font-size: 12px; margin-bottom: 8px; }
      #cs-card .cs-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 8px 12px; border-top: 1px solid #d0d7de; }
      #cs-card .cs-copy { border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
      #cs-card .cs-regen { border: 1px solid #d0d7de; background: #fff; border-radius: 6px; padding: 6px 12px; cursor: pointer; color: #57606a; }
      #cs-card .hidden { display: none; }
      #cs-card .cs-ask { display: flex; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #eee; }
      #cs-card .cs-ask-input { flex: 1; border: 1px solid #d0d7de; border-radius: 6px; padding: 6px 8px; font: inherit; }
      #cs-card .cs-ask-input:disabled { background: #f6f8fa; }
      #cs-card .cs-ask-btn { border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 6px; padding: 6px 10px; cursor: pointer; }
      #cs-card .cs-copy, #cs-card .cs-regen, #cs-card .cs-ask-btn { font: inherit; color: #1f2328; }
      #cs-card .cs-followup { margin-top: 10px; padding-top: 8px; border-top: 1px dashed #d0d7de; font-size: 13px; line-height: 1.5; }
      #cs-card .cs-followup.error { color: #dc2626; }
      /* Markdown rendering */
      #cs-card .cs-result h1, #cs-card .cs-result h2, #cs-card .cs-result h3,
      #cs-card .cs-result h4, #cs-card .cs-result h5, #cs-card .cs-result h6 {
        font-size: 13px; font-weight: 700; margin: 12px 0 4px; color: #1f2328;
      }
      #cs-card .cs-result h1, #cs-card .cs-result h2, #cs-card .cs-result h3 { font-size: 14px; }
      #cs-card .cs-result p { margin: 0 0 8px; }
      #cs-card .cs-result ul, #cs-card .cs-result ol { margin: 0 0 8px; padding-left: 20px; }
      #cs-card .cs-result li { margin: 2px 0; }
      #cs-card .cs-result code { background: #f0f1f3; padding: 1px 4px; border-radius: 4px; font-size: 12px; }
      #cs-card .cs-result pre { background: #f0f1f3; padding: 8px; border-radius: 6px; overflow: auto; }
      #cs-card .cs-result pre code { background: none; padding: 0; }
      #cs-card .cs-result blockquote { margin: 0 0 8px; padding: 2px 0 2px 10px; border-left: 3px solid #d0d7de; color: #57606a; }
      #cs-card .cs-result a { color: #2563eb; text-decoration: underline; }
      #cs-card .cs-result strong { font-weight: 700; }
      #cs-card .cs-result em { font-style: italic; }
      #cs-card .cs-result hr { border: none; border-top: 1px solid #d0d7de; margin: 10px 0; }
    `;
    document.documentElement.appendChild(style);
  }

  function ensureCard() {
    if (cardEl && document.documentElement.contains(cardEl)) return cardAPI();
    injectStyle();

    cardEl = document.createElement("div");
    cardEl.id = "cs-card";
    cardEl.innerHTML = `
      <div class="cs-header"><span>Doxa — Reddit &amp; YouTube Summarizer</span><button class="cs-close" title="Close">×</button></div>
      <div class="cs-body">
        <div class="cs-status pending"></div>
        <div class="cs-meta hidden"></div>
        <div class="cs-result hidden"></div>
        <div class="cs-followup hidden"></div>
        <div class="cs-ask hidden">
          <input class="cs-ask-input" type="text" placeholder="Ask a follow-up…" />
          <button class="cs-ask-btn">Ask</button>
        </div>
      </div>
      <div class="cs-footer hidden"><button class="cs-copy">Copy</button><button class="cs-regen">Regenerate</button></div>
    `;
    cardEl.querySelector(".cs-close").addEventListener("click", () => cardEl.remove());
    cardEl.querySelector(".cs-copy").addEventListener("click", async () => {
      const txt = cardEl.querySelector(".cs-result").textContent;
      try {
        await navigator.clipboard.writeText(txt);
        const b = cardEl.querySelector(".cs-copy");
        b.textContent = "Copied";
        setTimeout(() => (b.textContent = "Copy"), 1200);
      } catch (_) {}
    });
    cardEl.querySelector(".cs-regen").addEventListener("click", () => regenerate());
    cardEl.querySelector(".cs-ask-btn").addEventListener("click", () => askFollowup());
    cardEl
      .querySelector(".cs-ask-input")
      .addEventListener("keydown", (e) => {
        if (e.key === "Enter") askFollowup();
      });
    document.documentElement.appendChild(cardEl);
    return cardAPI();
  }

  function cardAPI() {
    const q = (sel) => cardEl.querySelector(sel);
    return {
      status(text, kind) {
        const s = q(".cs-status");
        s.textContent = text;
        s.className = "cs-status " + (kind === "error" ? "error" : "pending");
        q(".cs-meta").classList.add("hidden");
        q(".cs-result").classList.add("hidden");
        q(".cs-followup").classList.add("hidden");
        q(".cs-ask").classList.add("hidden");
        q(".cs-footer").classList.add("hidden");
      },
      result(text, countLabel, model) {
        const s = q(".cs-status");
        s.textContent = "Done.";
        s.className = "cs-status";
        q(".cs-meta").textContent = `${countLabel} · ${model}`;
        q(".cs-meta").classList.remove("hidden");
        q(".cs-result").innerHTML = renderMarkdown(text);
        q(".cs-result").classList.remove("hidden");
        q(".cs-followup").classList.add("hidden");
        q(".cs-ask").classList.remove("hidden");
        q(".cs-footer").classList.remove("hidden");
      },
      renderFollowup(text) {
        q(".cs-followup").className = "cs-followup";
        q(".cs-followup").innerHTML = renderMarkdown(text);
        q(".cs-followup").classList.remove("hidden");
        scrollBody();
      },
      renderFollowupError(text) {
        q(".cs-followup").className = "cs-followup error";
        q(".cs-followup").textContent = text;
        q(".cs-followup").classList.remove("hidden");
        scrollBody();
      },
      askPending() {
        const input = q(".cs-ask-input");
        input.placeholder = "Asking…";
        input.disabled = true;
      },
      askDone() {
        const input = q(".cs-ask-input");
        input.placeholder = "Ask a follow-up…";
        input.disabled = false;
        input.value = "";
        input.focus();
      },
      list(title, text) {
        const s = q(".cs-status");
        s.textContent = title;
        s.className = "cs-status pending";
        q(".cs-meta").textContent = "";
        q(".cs-meta").classList.remove("hidden");
        q(".cs-result").textContent = text;
        q(".cs-result").classList.remove("hidden");
        q(".cs-followup").classList.add("hidden");
        q(".cs-ask").classList.add("hidden");
        q(".cs-footer").classList.add("hidden");
      },
    };
  }

  // --- safe Markdown -> HTML ---
  function scrollBody() {
    if (!cardEl) return;
    const body = cardEl.querySelector(".cs-body");
    if (body) {
      try {
        body.scrollTop = body.scrollHeight;
      } catch (_) {}
    }
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function inlineMd(s) {
    let out = escapeHtml(s);
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    out = out.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>',
    );
    return out;
  }

  function renderMarkdown(md) {
    const lines = String(md || "").split(/\r?\n/);
    const out = [];
    let inList = null;
    let items = [];
    const closeList = () => {
      if (inList) {
        out.push(`<${inList}>${items.map((li) => `<li>${li}</li>`).join("")}</${inList}>`);
        inList = null;
        items = [];
      }
    };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      const head = line.match(/^(#{1,4})\s+(.*)$/);
      const ul = line.match(/^\s*[-*]\s+(.*)$/);
      const ol = line.match(/^\s*\d+\.\s+(.*)$/);
      const bq = line.match(/^\s*>\s?(.*)$/);

      if (head) {
        closeList();
        const level = Math.min(3, head[1].length) + 2;
        out.push(`<h${level}>${inlineMd(head[2])}</h${level}>`);
        continue;
      }
      if (ul || ol) {
        const type = ul ? "ul" : "ol";
        const content = inlineMd((ul || ol)[1]);
        if (inList !== type) {
          closeList();
          inList = type;
        }
        items.push(content);
        continue;
      }
      if (!line.trim()) {
        closeList();
        continue;
      }
      if (bq) {
        closeList();
        out.push(`<blockquote>${inlineMd(bq[1])}</blockquote>`);
        continue;
      }
      closeList();
      out.push(`<p>${inlineMd(line)}</p>`);
    }
    closeList();
    return out.join("\n");
  }
})();
