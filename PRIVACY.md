# Doxa — Privacy Policy

_Last updated: 2026-09-12_

Doxa is a comment and video summarizer. It ships as a **macOS app that contains a
Safari extension**, and as a **Firefox add-on**. This page explains what data Doxa
handles and where it goes.

In short: **there is no account, no Doxa server, no analytics, no tracking, and no
selling of data.** The developer never receives your data. Almost everything stays
on your machine or your own network, and any third-party processing only happens
if you explicitly set it up.

## 1. What Doxa stores

Doxa stores **settings in your browser's local extension storage** only. This
includes:

- Which summarization provider you chose (Ollama, or any OpenAI-compatible server
  such as OpenRouter or a custom base URL) and that provider's URL.
- The model name(s) you selected.
- Any **API keys** you enter (an OpenAI-compatible/OpenRouter key and/or a YouTube
  Data API key).
- Which sites you enabled (Reddit, YouTube) and your comment-limit settings.

These never leave your browser. They are not transmitted to the developer. You can
delete them at any time by clearing the extension's data or uninstalling the app.

## 2. What data Doxa processes, and where it is sent

Doxa reads the content **you ask it to summarize** (the comments on a Reddit
thread, or a YouTube video's comments) and sends it to the provider you chose:

- **Local providers (Ollama, or an OpenAI-compatible server on your own machine or
  network).** The comment text is sent to that local server only and does **not**
  leave your machine or local network.
- **OpenRouter / other OpenAI-compatible endpoints.** If you configure an online
  provider, the comment text is sent to that endpoint to generate a summary. This
  is **optional** and only happens if you select such a provider and enter an API
  key. Any data sent there is governed by that provider's own privacy policy.
- **YouTube Data API.** To read a YouTube video's comments, Doxa sends the video ID
  and your YouTube Data API key to Google's YouTube Data API. This is used only to
  fetch the comments you asked to summarize.
- **"Summarize with Gemini."** This button opens gemini.google.com in a new tab and
  copies a prompt (the video URL) to your clipboard. Doxa **does not** automatically
  send anything to Google; data is transmitted only if and when **you** paste the
  prompt and send it in Gemini.
- **Update check.** Doxa asks GitHub's public API
  (`api.github.com/repos/nschoch/doxa/releases/latest`) whether a newer version
  exists. That request contains no personal data and no page content — only the
  request itself.

Doxa does **not** read, collect, or transmit your browsing history, passwords,
personal information, or any page content other than the comments you explicitly
ask it to summarize.

## 3. No analytics, no tracking, no advertising

Doxa contains no analytics, no telemetry, no crash reporting, no advertising or
ad-tracking SDKs, and no third-party identifiers. It does not use cookies, and it
does not track you across sites.

## 4. Caching

While you're on a page, Doxa may keep the last summary **in memory** for that page
so re-opening the summary doesn't re-run the model. This cache is not written to
persistent storage and is cleared when you leave the page.

## 5. Your control

- You choose whether to use a **local** provider (your data stays on your network)
  or an **online** provider.
- You enter and can remove API keys at any time in the extension's settings.
- You can disable summarization on Reddit and/or YouTube in the settings.

## 6. Children's privacy

Doxa does not knowingly collect any personal information from children. It
processes only the content you explicitly ask it to summarize, locally by default.

## 7. Changes to this policy

If this policy changes, the updated version will be posted here with a new
"Last updated" date.

## 8. Contact

For questions about this policy or about Doxa, open an issue on the project's
GitHub repository: <https://github.com/nschoch/doxa/issues>
