# Doxa — Privacy Policy

_Last updated: 2026-09-06_

Doxa is a browser extension (Safari / Firefox) that summarizes Reddit comment
threads and YouTube videos. This page explains what data the extension handles
and where it goes. In short: **there is no analytics, no tracking, and no selling
of data.** Almost everything stays on your machine or your own network, and any
third-party processing only happens if you explicitly set it up.

## 1. What the extension stores

Doxa stores **settings in your browser's local extension storage** only. This
includes:

- Which summarization provider you chose (Ollama, OpenRouter, or Ninfer) and the
  provider's URL.
- The model name(s) you selected.
- Any **API keys** you enter (OpenRouter, Ninfer, and/or YouTube Data API).
- Which sites you enabled (Reddit, YouTube) and your max-comments setting.

These never leave your browser. You can delete them at any time by clearing the
extension's data or uninstalling the extension.

## 2. What data the extension processes, and where it is sent

Doxa reads the content **you ask it to summarize** (the comments on a Reddit
thread, or a YouTube video's comments) and sends it to the provider you chose:

- **Local providers (Ollama / Ninfer).** Your selected provider runs on **your own
  computer or your own network**. The comment text is sent to that local server
  only and does **not** leave your machine or local network.
- **OpenRouter.** If you choose OpenRouter, the comment text is sent to
  OpenRouter's API to generate a summary. This is **optional**; it only happens
  if you select OpenRouter as your provider and enter an API key.
- **YouTube Data API.** To read a YouTube video's comments, Doxa sends the video
  ID and your YouTube Data API key to Google's YouTube Data API. This is used
  only to fetch the comments you asked to summarize.
- **"Summarize with Gemini."** This button simply opens gemini.google.com in a
  new tab and copies a prompt (the video URL) to your clipboard. Doxa **does not**
  automatically send anything to Google; the data is transmitted only if and when
  **you** paste the prompt and send it in Gemini.

Doxa does **not** read, collect, or transmit your browsing history, passwords,
personal information, or any page content other than the comments/transcript you
explicitly ask it to summarize.

## 3. No analytics, no tracking, no advertising

Doxa contains no analytics, no telemetry, no crash reporting, no advertising or
ad-tracking SDKs, and no third-party identifiers. It does not use cookies.

## 4. Caching

While you're on a page, Doxa may keep the last summary **in memory** for that
page so re-opening the summary doesn't re-run the model. This cache is not written
to persistent storage and is cleared when you leave the page.

## 5. Your control

- You choose whether to use a **local** provider (your data stays on your
  network) or an **online** provider.
- You enter and can remove API keys at any time in the extension's settings.
- You can disable summarization on Reddit and/or YouTube in the settings.

## 6. Children's privacy

The extension does not knowingly collect any personal information from children.
It processes only the content you explicitly provide and does so locally by
default.

## 7. Changes to this policy

If this policy changes, the updated version will be posted here with a new
"Last updated" date.

## 8. Contact

For questions about this policy or the extension, open an issue on the project's
GitHub repository, or contact the developer through the repository.
