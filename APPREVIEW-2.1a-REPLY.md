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
> 2. The button now always performs its action: if the API reports an error,
>    the app opens the System Settings Extensions pane via a
>    system-preferences URL; if the API does not report at all, a timed
>    fallback triggers the same action. In every case the app quits, as the
>    button label promises.
> 3. The extension on/off state shown in the app window uses the same
>    corrected identifier and now reflects the actual state.
>
> We verified the fixed build on a physical Mac: selecting the button opens
> System Settings on the Extensions pane with Doxa listed, and the app quits.
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
