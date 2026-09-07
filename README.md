# Comment Summarizer (Ollama)

A cross-browser extension (Firefox + Safari) that summarizes **Reddit thread
comments** and **YouTube video comments** using a **local Ollama** LLM. Nothing
leaves your machine. Click the toolbar button on a Reddit thread or a YouTube
video and it reads the comments, summarizes them, and shows you a structured
TL;DR.

```
┌────────────┐   collect    ┌──────────────┐   POST /api/chat   ┌───────────┐
│   popup    │──────────────▶│  content.js  │     background.js   │  Ollama   │
│ (button+UI)│  tabs.sendMsg │  (reads DOM) │────▶ localhost:11434│ (local LLM)│
└────────────┘               └──────────────┘                    └───────────┘
```

## Requirements

- **Ollama** available over HTTP. This setup uses a LAN host, e.g.
  `http://10.20.10.99:11434` (it can also be local `127.0.0.1:11434`).
- A model pulled on that host, e.g. `qwen3.6:35b-a3b`.
- **Firefox** (to load the extension directly) and/or **Xcode + Safari**
  (to convert and run on Safari).

## 1. Set up Ollama

On the machine running Ollama, pull a model:

```bash
ollama pull qwen3.6:35b-a3b
```

By default Ollama only allows cross-origin requests from `localhost`. Because
the extension calls it over the network from its own origin, enable CORS.
Set the `OLLAMA_ORIGINS` environment variable before starting the server:

```bash
# allow any origin (simplest for local/LAN use)
OLLAMA_ORIGINS=* ollama serve
```

If you run Ollama as a background service, stop it and start it with the env
var (or add it to your launch config). Test it reaches the model:

```bash
curl http://10.20.10.99:11434/api/chat -d '{
  "model":"qwen3.6:35b-a3b",
  "messages":[{"role":"user","content":"Say hello"}],
  "stream":false
}'
```

## 2. Install in Firefox (fastest)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `extension/manifest.json` in this folder.
4. Navigate to a Reddit thread or a YouTube video and click the extension's
   toolbar icon.

The extension loads temporarily (until Firefox restarts). For a permanent
install, zip the `extension/` folder and install it via
`about:addons` → gear → **Install Add-on From File** (requires signing, or use
Firefox Developer/Nightly with unsigned add-ons, or sign through Mozilla).

## 3. Convert for Safari

Safari doesn't load extension folders directly: a Safari extension must live
inside a small macOS **container app**. You convert the same `extension/` folder
with Apple's command-line converter (bundled with Xcode). **You need Xcode** —
install it from the App Store, then in Terminal run:

```bash
xcrun safari-web-extension-converter \
  --project-name CommentSummarizer \
  --app-name "Comment Summarizer" \
  --bundle-identifier com.example.commentsummarizer \
  --macos-only \
  --force \
  extension/
```

> **If `xcrun` says "unable to find utility":** your `xcode-select` is pointed at
> the Command Line Tools, not Xcode. Either fix it (`sudo xcode-select -s
> /Applications/Xcode.app/Contents/Developer`), or call the converter directly by
> its full path:
> `/Applications/Xcode.app/Contents/Developer/usr/bin/safari-web-extension-packager`
> with the same flags. (Both produce the same project.)

That generates an Xcode project. Then:

1. Open the generated `.xcodeproj` in Xcode.
2. Select the **Comment Summarizer** target → **Signing & Capabilities** → set
   your **Team** (a free personal Apple ID team works to run on your own Mac).
   If you don't have a team, create one in Xcode → Settings → Accounts.
3. Pick a device (e.g. **My Mac**) and press **Run** (⌘R). This builds and
   launches the container app and registers the extension with Safari.
4. Enable the extension:
   - Safari → **Settings → Extensions** → toggle **Comment Summarizer** **on**.
   - If it isn't listed, first enable Safari's **Develop** menu
     (Safari → Settings → Advanced → check **"Show features for web developers"**),
     then **Develop → Allow Unsigned Extensions**, and re-check Settings.
   - When prompted, grant it permission to run on `reddit.com` / `youtube.com`.
5. To make changes later, re-run the converter with `--force`, or edit the files
   inside the Xcode project's `Resources` folder and rebuild.

> **What to do if the converter warns about manifest keys:** it reports keys
> Safari doesn't fully support. `background.scripts` in MV3 is the usual one —
> leave it (recent Safari handles it), or if Safari shows no background running,
> convert the folder (optionally) and let the packager pick the compatible
> shape. The packager logs the specifics, so read its output.

> **Unsigned extensions need re-enabling:** after Safari quits/relaunches, it
> can disable an unsigned extension. Re-check **Develop → Allow Unsigned
> Extensions**, then toggle it on again in Settings.

### Install on another Mac / device

To actually *distribute* it you must sign and notarize the container app via
your Apple Developer account (even a free one can't ship a standalone
extension). For personal single-Mac use, the unsigned develop-and-run flow
above is enough.

## Usage

1. Open a Reddit thread or a YouTube video.
2. Click the **Doxa** toolbar button:
   - **Summarize comments** — summarizes the thread's comments. On **YouTube**
     this uses the **YouTube Data API** (if you've added a key) to reliably
     fetch the comments; otherwise it falls back to auto-scroll DOM scraping.
   - **Summarize with Gemini (open in tab)** — (on a YouTube video) opens a
     fresh `gemini.google.com` chat and **copies the prompt** ("Summarize this
     video: <url>") to your clipboard. Paste it (⌘V) and press Send. (Gemini
     strips URL prompt params, so we can't auto-fill.)
3. The summary appears as an **on-page card** (bottom-right), so it keeps running
   even if you switch tabs or close the popup. Use **Copy** on the card.
4. **Ask a follow-up** — after a summary, type a question in the card's
   "Ask a follow-up…" field. The answer is grounded in the same source
   (the comments) and rendered below the summary.

> **Repeat clicks reuse the last result.** If you summarize the same page again
> (without refreshing), the card shows the cached summary instead of re-running
> the model. Use the card's **Regenerate** button (or reload the page) to force a
> fresh summary.

### Settings (in the popup)

- **Provider** — `Ollama (local)`, `OpenRouter (online)`, or `Ninfer (local,
  OpenAI-compatible)`. Each provider's model is saved **separately**, so
  switching doesn't clobber values.
- **Ollama URL** — defaults to `http://10.20.10.99:11434` (run the server with
  `OLLAMA_ORIGINS=*` so the extension's browser requests are allowed).
- **Ollama model** — your pulled local model, e.g. `qwen3.6:35b-a3b`.
- **OpenRouter model** — an OpenRouter model id, e.g. `openai/gpt-4o-mini`.
- **Ninfer URL** — an OpenAI-compatible ninfer endpoint, e.g.
  `http://10.20.10.99:8000/v1`.
- **Ninfer model** — the model served by ninfer, e.g. `qwen3.6-27b-ninfer`.
- **LLM API key** — for OpenRouter (required) or Ninfer (optional). Distinct from
  the YouTube Data API key; it's the key for the summarization model.
- **Sites** — checkboxes to enable **Reddit** and **YouTube**, plus a **YouTube
  Data API key** field right under the YouTube toggle. The extension only acts on
  enabled sites (this stops Safari asking to access every website). YouTube
  additionally requires a Data API key.
- **Fetch available models** — queries the active provider
  (Ollama `/api/tags`, or the OpenAI-compatible `/models` endpoint) and lets you
  pick a model to fill the model field.
- **Timeout (seconds)** — how long to wait before failing. Bump to 300–600 if a
  large local model is slow. Default 180.
- **Max comments** — cap on comments sent (keeps requests fast).
- **Auto-save settings** — persists changes as you type.

> **Privacy note:** Ollama and ninfer keep everything on your LAN. OpenRouter
> sends the extracted text to an external API — only use it if that's OK.

## File structure

```
extension/
  manifest.json    # MV3 manifest (Firefox/Safari)
  background.js    # provider call (Ollama / ninfer / OpenRouter) + configurable timeout
  content.js       # extractors, transcript grab, on-page card, follow-up, orchestration
  popup.html/css   # toolbar popup (trigger + settings)
  popup.js         # triggers the content script, saves settings
  icons/           # placeholder toolbar icons
```

## Caveats / known limitations

- **YouTube transcript:** the extension reads the video's caption tracks from the
  page. Not all videos have captions; auto-generated ones may be rough. The
  transcript is truncated to ~120k chars before summarization.
- **YouTube comment lazy-loading:** auto-scroll loads loaded comments; content
  may still be partial.
- **Reddit DOM churn:** Reddit A/B-tests its UI; the extractors cover the current
  `shreddit-comment`, `[data-testid="comment"]`, and old-style layouts, but may
  need updates if Reddit changes.
- **CORS:** run Ollama with `OLLAMA_ORIGINS` allowing the extension, or requests
  are blocked. A local ninfer/OpenAI-compatible server should also allow the
  extension's origin (set `OLLAMA_ORIGINS=*` for Ollama).
- **Host permission:** the extension requests access to the enabled sites
  (reddit.com, youtube.com), the provider endpoints (Ollama `:11434`,
  OpenRouter), and `www.googleapis.com` (the YouTube Data API, fetched from the
  background so it's CORS-safe). It no longer uses `<all_urls>`, so Safari won't
  prompt on other sites. A **ninfer** server must be on the same host as Ollama's
  `:11434` permission or its exact host:port added to `host_permissions` (tell me
  the host and I'll add it).
- **Model quality:** small models produce rougher summaries; larger is better
  but slower.
- **Privacy:** Ollama and ninfer keep everything on your LAN. OpenRouter sends
  text to an external API.
