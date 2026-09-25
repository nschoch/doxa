# Doxa 1.1.2

Fixes the summary card going missing on pages that re-render.

## Fixed

- **The on-page summary card could become invisible.** Doxa injects a small
  `<style>` block that positions the card in the bottom-right corner. If the page
  (or the browser) removed that node — common on sites that re-render, and after
  a content-script reload — every later summarize re-created the card without
  any styling: an unstyled `<div>` at the end of `<html>`, effectively invisible,
  while the popup still reported *"Working… watch the card on the page"*. The
  style is now re-injected whenever it is no longer in the document.

  This was the behaviour reported after 1.1.1, so it is the reason to take this
  update.

## Changed

- The bundled web extension now carries the platform gate that keeps third-party
  update checks out of the Mac App Store build (App Store guideline 2.4.5(vii)).
  In Firefox it is inert: the **"Update available"** banner and the
  **Check for updates** link work exactly as before.

## Install

- **Existing installs** — the toolbar popup shows an **"Update available"**
  banner; use **View release**, then install
  `doxa-1.1.2-fx.xpi` from this release. (Self-hosted add-ons can't update
  themselves.)
- **New installs** — download `doxa-1.1.2-fx.xpi` and open it in Firefox, or
  install from the add-on's page.
- `doxa-extension-1.1.2.zip` is the unsigned source build, for developers.

Requires Firefox 142 or later.
