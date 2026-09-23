# App Review reply — Guideline 2.1(a) re-rejection (round 13)

**Rejection:** *"No Action occurs when the user selects 'Quit and Open Safari
Extension Preferences…'"* (reviewer device: MacBook Pro 14" Nov 2024, macOS 27.0).

Two paste-ready texts below: a **short** reply for the Resolution Center
(fits comfortably in the message box) and a **detailed** one if Apple asks for
more. Replace the `[version]` / `[build]` placeholders before sending.

---

## A. Short reply (paste into Resolution Center)

> Thank you for the detailed feedback. We reproduced the issue and fixed it in
> the new build.
>
> Root cause: the app's "Quit and Open Safari Settings…" button calls the
> Safari web extension API `showPreferencesForExtension(withIdentifier:)`. The
> identifier passed to that API was an outdated template value that did not
> match the bundle identifier of the Safari web extension the app actually
> bundles. On recent macOS, when the identifier does not match a known
> extension, the API opens no settings pane and does not call its completion
> handler, so nothing appeared to happen.
>
> What changed in this build:
> 1. The app now resolves the real bundle identifier of the Safari web
>    extension it ships (read from the bundled extension itself, with the
>    correct identifier as fallback), so the API call always targets the real
>    extension.
> 2. The button now always performs its action. If Safari's API reports an
>    error — which it does on macOS 15 and later until the extension has been
>    enabled once — the app brings Safari, the app that owns the extension
>    toggle (Safari → Settings → Extensions), to the front. On macOS 13–14 it
>    opens Privacy & Security → Extensions instead, which is where those
>    versions list Safari extensions. If the API does not respond at all, a
>    timed fallback performs the same action. In every case the app quits, as
>    the button label promises.
> 3. The window's implementation of the button label and state text now names
>    the current UI path (Safari → Settings → Extensions), and the extension
>    on/off state is read through the corrected identifier.
>
> We verified the behaviour on a physical Mac running macOS 27 with a clean
> install: selecting the button brings Safari (or, on macOS 13–14, the
> Extensions pane) forward and the app quits; with the extension enabled,
> summarizing runs end to end.
>
> The resubmitted build is version [version] (build [build]).

---

## B. Detailed reply (if requested)

Same as A, plus:

> Technical detail: the app window is a WKWebView whose button posts an
> "open-preferences" message to a native script-message handler. That handler
> called `SFSafariApplication.showPreferencesForExtension(withIdentifier:)` with
> a placeholder identifier left over from Xcode's Safari web extension project
> template, and scheduled the app's termination inside that call's completion
> handler. On current macOS versions the completion handler is not invoked
> when the identifier does not correspond to an installed extension, which
> left the button with no visible effect. The completed fix (source:
> `ViewController.swift`) resolves the identifier from the extension bundle
> embedded in the app, adds an explicit fallback that opens the System
> Settings Extensions pane via the `x-apple.systempreferences` URL scheme, and
> adds a timed guarantee that the app terminates regardless of whether the
> Safari API reports success or failure.

---

## C. Owner checklist before/while resubmitting

- [ ] Build on the Mac in Xcode (⌘R), click the button, confirm System
      Settings opens on the Extensions pane (Doxa listed) and the app quits.
- [ ] Confirm the window shows the real state line (e.g. "Doxa's extension is
      currently on…") instead of the generic "You can turn on Doxa's
      extension…" line.
- [ ] If the extension is OFF in your Safari settings, also test the OFF
      state: the line should say "currently off".
- [ ] Archive → Export for App Store → upload in App Store Connect.
- [ ] Fill `[version]`/`[build]` in section A, post it in the Resolution
      Center, then click **Resubmit to App Review**.
- [ ] Note for the reply: if Apple's QA re-tests, the button's label on
      macOS 13+ reads "Quit and Open Safari Settings…" (the rejection quoted
      the pre-state label, which the fixed build no longer shows in a
      working state).

---

## D. App Review / Test Information fields (paste-ready)

Both required fields in the ASC "Test Information" form (Test Information page
of the resubmission / TestFlight flow). `Next` stays disabled until they're
filled.

**Beta App Description** (required, 4000 char limit — this text is ~1.4k):

> Doxa is a Safari web extension that summarizes Reddit and YouTube comment
> sections on the page you are viewing.
>
> To test the extension:
> 1. Launch Doxa. In the app window, click "Quit and Open Safari Settings…".
>    System Settings opens on the Extensions pane, where Doxa is listed, and
>    Doxa quits. (This is the flow reported as doing nothing in the previous
>    build; it is fixed in this one — if the Safari API does not respond, the
>    app opens the Extensions pane directly and still quits.)
> 2. In System Settings > Extensions, enable Doxa and allow it for
>    reddit.com and youtube.com.
> 3. Open any Reddit thread or YouTube video with comments, then click the
>    Doxa icon in the Safari toolbar, or press Command-Option-S. A summary
>    card appears in the bottom-right corner of the page.
> 4. On YouTube, Command-Option-G summarizes the video with Gemini.
>
> Summarization uses either a local Ollama instance (default
> http://localhost:11434) or an API key entered in Doxa's settings. No account
> or sign-in is required, and settings are stored locally on the Mac.

**Feedback Email** (required): your address (e.g. the one in `git config
user.email`).

**Contact Information**: First Name / Last Name / Phone number / Email — your
details; Apple uses these if the reviewer needs to reach you.

**Sign-In Information — UNCHECK "Sign-in required".** Doxa has no accounts or
login. Leaving it checked (with empty User Name / Password) blocks the form's
validation. Only provide credentials if you deliberately add a demo account.

Optional: if you want the reviewer to exercise hosted summarization rather
than local Ollama, paste the demo OpenRouter key from your local review notes
into the description above. It is gitignored and was already slated for
rotation after approval — never commit or paste it anywhere else.

**After this form:** continue with `Next`, attach the newly processed build to
version **1.0** (do not change the version), then click **Resubmit to App
Review**.
