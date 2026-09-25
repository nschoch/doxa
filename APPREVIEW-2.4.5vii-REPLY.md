# App Review reply — Guideline 2.4.5(vii) rejection (round 16)

**Rejection:** *"The app updates itself outside of the Mac App Store."*
Guideline **2.4.5(vii) – Performance**, version 1.0, review device MacBook Pro
14-inch (Nov 2024), macOS 27.0, September 25, 2026 — with a screenshot of the
Doxa popup.

**Actual cause:** the macOS app has no updater (no Sparkle, no appcast, no
download or install code anywhere in the project). The **bundled Safari
extension** carried a GitHub Releases *check* inherited from the Firefox build:
the popup rendered an amber **"Update available"** banner and a footer
**"Check for updates"** link, and the background script queried
`api.github.com/repos/.../releases/latest`. Nothing was ever installed — the
link only opened the release web page — but that is still what the guideline
describes, so it is gone from the store build.

**Fix (this build):** in Safari the updater is dormant — popup gate in
`extension/popup.js`, refusal at the single `check-update` handler in
`extension/background.js`, so no GitHub request is possible. The Firefox
self-hosted `.xpi` (which no store can update) keeps the checker. Extension
manifest bumped **1.2.1 → 1.2.2** so the fixed build is identifiable in Safari →
Settings → Extensions. App marketing version stays **1.0**.

Verification: `node tools/verify-no-self-update.mjs` — GREEN, and red-capable
(`--break=always-enabled`, `--break=never-enabled`, `--break=banner-on-load`,
`--break=no-refuse` each exit 1).

Replace `[build]` before sending.

---

## A. Short reply (paste into Resolution Center)

> Thank you for the review and for the screenshot. We have removed the update
> user interface from the Mac App Store build.
>
> To be precise about the cause: the macOS app itself contains no updater — it
> never downloads, installs or replaces anything, and there is no Sparkle
> framework, appcast or update feed in the project. What your screenshot shows
> is the popup of the Safari web extension that the app bundles, which (having
> been ported from our self-hosted Firefox build) checked the project's public
> GitHub Releases page and offered a link to it, labelled "Update available" and
> "Check for updates". That check has now been removed from the Safari build
> entirely: the popup no longer shows the update banner or the update link, and
> the code path that contacted the GitHub API is gone, so the extension makes no
> update request of any kind. Updates reach users through the Mac App Store, as
> the guideline requires.
>
> Concretely, in this build:
> 1. The extension's update banner, its "Check for updates" footer link and
>    the related code have been removed from the Safari build. The popup now
>    shows only the installed version, which is informational.
> 2. The Safari build cannot perform or suggest an external update: the single
>    code path that queried the GitHub Releases API is disabled, and the
>    background script refuses any update request before it can make a network
>    call.
> 3. Nothing in the macOS app or the bundled extension downloads, installs or
>    launches an update. The app has no update mechanism of its own.
>
> The extension version in this build is 1.2.2 (visible in Safari → Settings →
> Extensions), which distinguishes it from the reviewed build (1.2.1).
>
> The resubmitted build is version 1.0 (build [build]). We would be grateful if
> you could take another look.

---

## B. Detailed reply (if requested)

Same as A, plus:

> Background: Doxa ships one extension code base to two channels — this Mac App
> Store app (Safari web extension) and a self-hosted Firefox add-on. The Firefox
> channel is distributed as an `.xpi` that the browser cannot update on its own,
> so it reports new releases. That reporting code was carried into the Safari
> build, where it is inappropriate, and that is the sole reason the update
> controls appeared.
>
> What changed: the extension now detects the runtime and, in Safari, never
> registers the update UI, never sends an update request, and the background
> script answers any such request with an explanatory refusal instead of
> contacting GitHub. There is no fetching, caching, prompting or linking for
> updates in the Safari build. The Firefox build is unchanged.
>
> The extension's manifest still declares `https://api.github.com/*` among its
> host permissions, because the same manifest ships to the Firefox channel.
> It is inert in the Safari build: with the update path disabled, the extension
> makes no request to that host. We can remove the entry from this channel in a
> future build if you prefer; we did not change the manifest structure now to
> avoid re-identifying the extension during review.
>
> If it is useful, we can attach a screenshot of the popup from the resubmitted
> build showing the removed controls; the popup in the reviewed screenshot was
> taken with the extension enabled and a Reddit tab open, and the same view in
> this build contains no update banner and no update link.
>
> For completeness, the app's other outbound connections are the user's own
> language-model endpoint (default `http://localhost:11434`, or an
> OpenAI-compatible HTTPS endpoint the user configures), and optional
> `googleapis.com` for YouTube comments with the user's own API key. There is no
> developer-operated server, no analytics and no account.
