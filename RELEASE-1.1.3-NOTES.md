# Doxa 1.1.3

**Fix: custom OpenAI-compatible servers could not be reached.** The extension's
`host_permissions` listed only openrouter.ai, googleapis.com, and api.github.com
for HTTPS. Any other provider — e.g. Qwen's Token Plan at
`https://token-plan.maas.qwencloudapi.com/compatible-mode/v1` — failed before
the request left the browser ("Load failed" in Safari, a network/CORS error in
Firefox). "Fetch available models" *and* summarization itself were affected for
every "Custom (any OpenAI-compatible server)" preset URL.

The manifest now grants `https://*/*`, matching the existing `http://*/*`
(needed for local Ollama) and the stated intent of the Custom preset. HTTPS is
where remote LLM providers live; requests carry the user's own API key over
TLS. No new content-script or data-collection surface: `content_scripts` still
match only reddit.com and youtube.com.

## Versioning

- Firefox (`extension/manifest.json`): **1.1.2 → 1.1.3** (tag `v1.1.3`)
- Safari / Mac App Store (`Resources/manifest.json`): **1.2.2 → 1.2.3**

Only the manifests changed; the five synced code files are byte-identical to
1.1.2.

## Update paths

- **Existing installs (Firefox)** — self-hosted add-ons can't update themselves;
  users get the "Update available" banner and install `doxa-1.1.3-fx.xpi` from
  this release. After installing, Firefox may re-prompt for the broadened host
  access.
- **New installs** — download `doxa-1.1.3-fx.xpi` and open it in Firefox, or
  load `extension/` temporarily from `about:debugging`.
- `doxa-extension-1.1.3.zip` is the unsigned source build, for developers.

## Safari / App Store

Requires an Xcode rebuild + archive on the Mac (GUI signing; CLI signing fails
with `errSecInternalComponent`). Safari shows the new version as 1.2.3 in
Settings → Extensions. Existing Safari users get the permission change through
the App Store update; no in-app action needed.

## Verified

- Both manifests parse; `tools/prep-firefox-release.mjs` validations all pass
  (manifests differ only by version; 5 synced files identical; credential scan
  clean).
- `tools/verify-no-self-update.mjs`: GREEN (2.4.5(vii) gate intact).
- `node --check` on background/popup/content scripts: clean.
- Endpoint reachability confirmed from outside: the Qwen Token Plan base URL
  serves `/models` behind auth (401 without a key), so with the host permission
  fixed, Doxa's fetch succeeds given a valid `sk-sp-…` Token Plan key.
