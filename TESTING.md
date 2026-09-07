# Testing Doxa

Thanks for helping test **Doxa** — an extension that summarizes Reddit comment
threads and YouTube videos. It runs the summary on a model you choose (a local
Ollama/ninfer server, or an online service like OpenRouter).

> **Note:** the extension's defaults point at the *developer's* network. For your
> own test you'll set your own provider (and add a YouTube Data API key if you
> want to summarize YouTube comments).

## Prerequisites (quick)

- A model provider:
  - **Easiest:** an **OpenRouter** API key (free tier available) — pick a model
    like `openai/gpt-4o-mini`. Get a key at openrouter.ai, or
  - A **local Ollama** machine (`ollama serve`, and run it with CORS open:
    `OLLAMA_ORIGINS=* ollama serve`).
- (Optional) A **YouTube Data API key** to summarize YouTube comments — free from
  console.cloud.google.com → enable **YouTube Data API v3**.

## Loading the extension — pick your browser

### Firefox (easiest)
1. Get the source: clone this repo (or download the `extension/` folder).
2. Open Firefox → `about:debugging#/runtime/this-firefox`.
3. **Load Temporary Add-on** → select `extension/manifest.json`.
4. Open the toolbar icon (it looks like a blue speech bubble) and configure
   Settings.

(It loads temporarily until Firefox restarts; that's fine for testing.)

### Safari (macOS)
1. Install **Xcode** (Mac App Store).
2. In Terminal, from the repo root, convert the source into an Xcode project:
   ```bash
   xcrun safari-web-extension-converter \
     --project-name Doxa \
     --app-name "Doxa" \
     --bundle-identifier com.example.doxa \
     --macos-only \
     --force \
     extension/
   ```
3. Open the generated `.xcodeproj`, select the **Doxa** target →
   **Signing & Capabilities** → set your **Team** (a free personal Apple ID
   works). Then **Run** (⌘R).
4. Enable the extension: **Safari → Settings → Extensions → Doxa**. If it's not
   listed, enable Safari's **Develop** menu (Settings → Advanced → "Show features
   for web developers"), then **Develop → Allow Unsigned Extensions**.

## Configure it

1. Click the **Doxa** toolbar icon → **Settings**.
2. **Provider** → choose **OpenRouter (online)** (paste your API key + a model) or
   **Ollama (local)** (set your Ollama URL + model).
3. If you want YouTube comments, paste your **YouTube Data API key** under
   **Sites → YouTube**.
4. **Site** toggles: make sure **Reddit** (and **YouTube**) are checked.
5. Settings save automatically.

## Using it

- On a **Reddit thread** → **Summarize comments** → a card appears (bottom-right)
  with the summary. You can ask a **follow-up** in the card, and use **Copy**.
- On a **YouTube video** → **Summarize comments** (needs a YouTube Data API key),
  or **Summarize YouTube video with Gemini** (opens Gemini in a tab; the prompt is
  on your clipboard — paste it and send).

## Troubleshooting

- **"Could not reach Ollama"** → the URL is wrong, or Ollama isn't running with
  `OLLAMA_ORIGINS=*`.
- **"Add a YouTube Data API key"** → enter one under Settings → Sites → YouTube.
- **No card appears** → make sure the site toggle for that page is enabled.
- **Anything else** → the card shows the real error; open an issue on this repo.
