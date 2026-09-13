# Doxa

Summarize **Reddit thread comments** and **YouTube video comments** in one click.
Click the toolbar button on a Reddit thread or a YouTube video and Doxa reads the
comments, summarizes them, and shows a structured TL;DR in an on-page card.

Doxa is a front end for a language model **you** choose and control. By default it
uses a **local Ollama** model, so nothing leaves your machine — or point it at any
OpenAI-compatible provider (OpenRouter, LM Studio, vLLM, your own server).

- **macOS / Safari** — installed from the Mac App Store
- **Firefox** — a signed `.xpi` from the latest release
- **Open source** — <https://github.com/nschoch/doxa>

## Install

### macOS (Safari)

1. Install **Doxa** from the Mac App Store. *(Coming soon — the 1.0 submission is
   in review. In the meantime, build it from source: see
   [DEVELOPMENT.md](DEVELOPMENT.md).)*
2. Open the app once — its window explains the setup.
3. Enable the extension: **Safari → Settings → Extensions → Doxa → on**.
4. When prompted, allow Doxa to run on `reddit.com` and `youtube.com`.

Install it once and it updates itself through the App Store.

### Firefox

1. Download the signed add-on (`doxa-<version>-fx.xpi`) from the latest
   [Release](https://github.com/nschoch/doxa/releases).
2. In Firefox open `about:addons` → gear icon → **Install Add-on From File…** and
   choose the `.xpi` (or drag the file onto the page).

Release Firefox only accepts Mozilla-signed add-ons, which is why you install the
signed `.xpi` rather than the source folder. Self-hosted builds don't auto-update —
Doxa shows an **"Update available"** banner instead (see
[Update checking](#update-checking)).

## Set up a provider

Doxa needs one summarization provider. Choose it in the extension's **Settings**
(click the toolbar button, then open the settings panel). You can also add an
optional **YouTube Data API key** to summarize YouTube comments reliably.

### Ollama (local, default)

Pull a model on the machine running Ollama:

```bash
ollama pull qwen3.6:35b-a3b
```

By default Ollama only allows cross-origin requests from `localhost`. Because
Doxa calls it from its own extension origin, enable CORS by setting
`OLLAMA_ORIGINS` **before** starting the server:

```bash
# allow any origin (simplest for local/LAN use)
OLLAMA_ORIGINS=* ollama serve
```

If Ollama runs as a background service, stop it and start it with the env var (or
add the variable to its launch configuration). Check that the model answers:

```bash
curl http://localhost:11434/api/chat -d '{
  "model":"qwen3.6:35b-a3b",
  "messages":[{"role":"user","content":"Say hello"}],
  "stream":false
}'
```

Then in Doxa's Settings: **Provider = Ollama**, **Ollama URL** =
`http://localhost:11434`, and pick your model. Nothing leaves your machine or LAN.

> **"Ollama returned 403"?** That's the CORS setting above — see
> [Troubleshooting](#troubleshooting).

### OpenAI-compatible (OpenRouter or your own server)

Set **Provider = OpenAI-compatible** and choose a **Preset**:

- **OpenRouter** — a hosted service. Enter an **LLM API key** (a free key is
  available at openrouter.ai) and a model id such as `openai/gpt-4o-mini`. No local
  server needed. The base URL is locked to `https://openrouter.ai/api/v1`.
- **Custom** — any server speaking the OpenAI chat-completions API, such as
  LM Studio, vLLM, or a local ninfer endpoint. Set the **Base URL** (e.g.
  `http://localhost:8000/v1`), the **Model**, and an API key only if your server
  requires one.

**Fetch available models** queries the active provider and fills the model field
for you.

> **Privacy:** Ollama and a custom server on your own machine/LAN keep everything
> local. OpenRouter sends the extracted comment text to an external API — see the
> [privacy policy](https://nickschoch.com/doxa/PRIVACY.html).

### Optional: YouTube Data API key

YouTube hides its comments behind a closed shadow DOM, so Doxa uses the **YouTube
Data API v3** to read them reliably (falling back to on-page scrolling when no key
is set). Get a free key at console.cloud.google.com → enable **YouTube Data API
v3** → create an API key, then paste it into Settings under the **YouTube**
toggle. Summarizing YouTube *comments* needs this key; the Gemini button below
does not.

## Usage

1. Open a Reddit thread or a YouTube video.
2. Click the **Doxa** toolbar button:
   - **Summarize comments** — summarizes the thread's comments. On **YouTube**
     this uses the **YouTube Data API** when you've added a key; otherwise it
     falls back to auto-scroll scraping.
   - **Summarize with Gemini (open in tab)** — on a YouTube video, opens a fresh
     `gemini.google.com` chat and **copies the prompt** ("Summarize this video:
     <url>") to your clipboard. Paste it (⌘V) and press Send. (Gemini strips URL
     prompt parameters, so the prompt can't be pre-filled.) This needs **no**
     YouTube Data API key.
3. The summary appears as an **on-page card** (bottom-right), so it keeps working
   if you switch tabs or close the popup. Use **Copy** on the card.
4. **Ask a follow-up** — after a summary, type a question into the card's
   "Ask a follow-up…" field. The answer is grounded in the same comments and
   rendered below the summary.

> **Repeat clicks reuse the last result.** Summarizing the same page again
> (without refreshing) shows the cached summary instead of re-running the model.
> Use the card's **Regenerate** button (or reload the page) to force a fresh run.

### Update checking

Doxa checks whether a newer version exists and, if so, shows an **"Update
available"** banner with a **View release** button that opens the release page.
The footer shows your installed version plus a **Check for updates** link to force
a re-check, and **×** dismisses the banner for that version.

- **Mac App Store installs** update automatically through the App Store, so the
  banner is informational only.
- **Firefox installs** (self-hosted `.xpi`) can't auto-update, so attaching the
  signed `.xpi` to each GitHub Release is what delivers the update.

Each new version must therefore be published as a GitHub Release with a version
tag (e.g. `v1.0.9`); pre-releases and drafts are ignored. Checks are rate-limited
to at most one GitHub API call every 6 hours per machine.

### Settings (in the popup)

- **Provider** — `Ollama (local)` or `OpenAI-compatible`. When you pick
  OpenAI-compatible, choose a **Preset**: **Custom** (any OpenAI-compatible
  server) or **OpenRouter**.
- **Ollama URL** — defaults to `http://localhost:11434` (run the server with
  `OLLAMA_ORIGINS=*` so the extension's browser requests are allowed).
- **Ollama model** — your pulled local model, e.g. `qwen3.6:35b-a3b`.
- **Base URL** — the OpenAI-compatible endpoint. For the **OpenRouter** preset
  this is locked to `https://openrouter.ai/api/v1`; for **Custom** set your
  server, e.g. `http://localhost:8000/v1` (ninfer/LM Studio/vLLM).
- **Model** — the model id for the OpenAI-compatible provider, e.g.
  `openai/gpt-4o-mini` (OpenRouter) or your local model.
- **LLM API key** — required for OpenRouter, optional for a custom local server.
  Distinct from the YouTube Data API key; it's the key for the summarization
  model.
- **Sites** — checkboxes to enable **Reddit** and **YouTube**, plus a **YouTube
  Data API key** field right under the YouTube toggle. The extension only acts on
  enabled sites (this stops Safari asking to access every website). On YouTube,
  **Summarize comments** needs a Data API key, but **Summarize with Gemini** does
  not — the Gemini button appears on any enabled YouTube video even before you add
  a key.
- **Fetch available models** — queries the active provider
  (Ollama `/api/tags`, or the OpenAI-compatible `/models` endpoint) and lets you
  pick a model to fill the model field.
- **Timeout (seconds)** — how long to wait before failing. Bump to 300–600 if a
  large local model is slow. Default 180.
- **Max comments** — cap on comments sent (keeps requests fast).
- **Max comments per thread (Reddit)** — how many comments each top-level Reddit
  thread contributes (default 30), so one huge off-topic thread can't crowd out
  the rest of the discussion. Raise it to sample deeper threads; set it near
  **Max comments** to effectively disable the per-thread cap.
- **Max reply depth (Reddit)** — how many reply levels under each top-level
  Reddit comment to include (default: no limit). **0** = top-level comments
  only; combine it with the per-thread cap to keep the sample out of deep
  off-topic tangents.
- **Auto-save settings** — persists changes as you type.

## Troubleshooting

- **"Ollama returned 403."** Ollama rejects the extension's `Origin`
  (`safari-web-extension://…` in Safari, `moz-extension://…` in Firefox) by
  default. Restart Ollama with `OLLAMA_ORIGINS` allowing that origin — simplest is
  `OLLAMA_ORIGINS=*`. On macOS with the Ollama app you can run
  `launchctl setenv OLLAMA_ORIGINS "*"` and then reopen the app. A custom local
  OpenAI-compatible server needs the same treatment.
- **The extension isn't listed in Safari → Settings → Extensions.** Open the Doxa
  app once — installing/launching the container app is what registers the
  extension with Safari.
- **Doxa can't see the page.** Check that the site's toggle is on under **Sites**
  in Settings, and that you approved the site access prompt for `reddit.com` /
  `youtube.com`.
- **Summaries are slow or time out.** Raise **Timeout (seconds)**, use a smaller
  model, or lower **Max comments**.
- **YouTube comments come back partial.** Without a Data API key Doxa falls back
  to auto-scroll, which may not reach every comment. Adding a key is the reliable
  fix.

## Known limitations

- **Comments only, not video transcripts** — Doxa summarizes a video's comments;
  it does not transcribe or summarize the spoken audio.
- **YouTube comment lazy-loading** — the auto-scroll fallback loads what it can;
  results may be partial without an API key.
- **Reddit DOM churn** — Reddit A/B-tests its interface. The extractors cover the
  current `shreddit-comment`, `[data-testid="comment"]`, and legacy layouts, but a
  Reddit redesign can require an update.
- **Model quality** — small models produce rougher summaries; larger models are
  better but slower.
- **Permissions** — Doxa requests access only to the sites it acts on
  (`reddit.com`, `youtube.com`), to `http://*/*` (so it can reach a provider you
  configure on any local/LAN host and port), and to `openrouter.ai`,
  `googleapis.com` (YouTube Data API), and `api.github.com` (update checks). It
  does not request `<all_urls>`. Prefer `localhost`/`127.0.0.1` or **https** for a
  plain-http provider — the popup warns when a non-loopback `http://` URL is set.

## Privacy

Doxa has no account, no server of ours, no analytics, no tracking, and no
advertising. Settings and any API keys you enter stay in your browser's local
extension storage. Comment text goes only to the provider **you** configure — your
own Ollama or local server by default.

Full policy: <https://nickschoch.com/doxa/PRIVACY.html>

## Support

- **Bug reports and questions:** <https://github.com/nschoch/doxa/issues>
- **Source code:** <https://github.com/nschoch/doxa>

## For developers

Building from source, converting for Safari, signing the Firefox `.xpi`,
notarizing, and the release process are documented in
**[DEVELOPMENT.md](DEVELOPMENT.md)**.
