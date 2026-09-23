#!/usr/bin/env bash
# Mac-side capture for: "the bottom-right summary pane doesn't appear when I
# summarize comments".
#
# Run this ON THE MAC, from the repo root:
#     bash tools/hitl-capture-extension.sh
#
# It dumps the facts an agent cannot read from Linux (OS version, which Doxa
# extension instances are registered/enabled, the minimum-OS each bundle
# declares) and walks you through the Safari-side checks, printing everything
# as KEY=VALUE at the end so the output can be pasted back.
#
# Nothing here writes to the system: read-only inspection plus prompts.

set -uo pipefail

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p "    [Enter when done] " _
}

capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  read -r -p "    > " answer
  printf -v "$var" '%s' "$answer"
}

dump_appex() {
  local app="$1" appex
  printf '  app: %s\n' "$app"
  /usr/libexec/PlistBuddy -c 'Print:CFBundleShortVersionString' "$app/Contents/Info.plist" 2>/dev/null \
    | sed 's/^/    app version: /'
  /usr/libexec/PlistBuddy -c 'Print:LSMinimumSystemVersion' "$app/Contents/Info.plist" 2>/dev/null \
    | sed 's/^/    app minOS:   /'
  find "$app/Contents/PlugIns" -maxdepth 1 -name '*.appex' 2>/dev/null | while read -r appex; do
    printf '    appex: %s\n' "$(basename "$appex")"
    /usr/libexec/PlistBuddy -c 'Print:CFBundleIdentifier' "$appex/Contents/Info.plist" 2>/dev/null \
      | sed 's/^/      id:      /'
    /usr/libexec/PlistBuddy -c 'Print:CFBundleShortVersionString' "$appex/Contents/Info.plist" 2>/dev/null \
      | sed 's/^/      version: /'
    /usr/libexec/PlistBuddy -c 'Print:LSMinimumSystemVersion' "$appex/Contents/Info.plist" 2>/dev/null \
      | sed 's/^/      minOS:   /'
    /usr/libexec/PlistBuddy -c 'Print:NSExtension:NSExtensionPointIdentifier' "$appex/Contents/Info.plist" 2>/dev/null \
      | sed 's/^/      point:   /'
  done
}

# --- facts ---------------------------------------------------------------

printf '\n=== macOS ===\n'
sw_vers

printf '\n=== Registered Safari web extensions (raw `pluginkit` output) ===\n'
printf '# a leading "+" normally marks the enabled entry; verify against the\n'
printf '# Extensions pane before trusting it\n'
pluginkit -m -v -p com.apple.Safari.web-extension 2>&1 | sed 's/^/    /'

printf '\n=== Doxa apps installed in the usual places ===\n'
for app in "/Applications/Doxa.app" "$HOME/Applications/Doxa.app"; do
  [ -d "$app" ] && dump_appex "$app"
done

printf '\n=== Doxa built by Xcode (DerivedData) ===\n'
find "$HOME/Library/Developer/Xcode/DerivedData" -maxdepth 6 \
  -path '*Build/Products*' -name 'Doxa.app' 2>/dev/null | while read -r app; do
  dump_appex "$app"
done

printf '\n=== Where the repo came from / current HEAD ===\n'
git -C "$(dirname "$0")/.." log --oneline -1 2>/dev/null | sed 's/^/    /'
git -C "$(dirname "$0")/.." status --short 2>/dev/null | sed 's/^/    /'

# --- interactive checks --------------------------------------------------

capture TRIGGER "How did you trigger the summarize? (toolbar-popup / keyboard-shortcut Cmd+Opt+S / other)"
capture POPUP_TEXT "What did the toolbar popup show right after you clicked Summarize? (e.g. 'Working… watch the card on the page', an error line, or 'nothing/never opened')"
capture EXT_ENABLED "In Safari > Settings > Extensions, is the Doxa entry(ies) checked ON? List what you see (name + version + checkbox state)"
capture SITE_ACCESS "For the Doxa entry you're testing: what does the website access row say for reddit.com/youtube.com? (Allow / Ask / Deny)"

step "Now capture the page-side error (skip if the pane appeared):
  1. Safari > Settings > Advanced > tick 'Show features for web developers' (if not already).
  2. Open the Reddit/YouTube page, then menu Develop > Show JavaScript Console.
  3. Trigger the summarize again.
  4. Copy any red/error lines (especially ones mentioning content.js, cs-card, browser is undefined, or 'Could not establish connection')."
capture CONSOLE_ERRORS "Paste the console errors, or 'none':"

step "Also reload the page once (Cmd+R) and trigger the summarize again, since
  content scripts only inject on a fresh page load after an extension update."
capture AFTER_RELOAD "After a hard reload, did the pane appear? (yes / no / still nothing)"

# --- output --------------------------------------------------------------

printf '\n--- Captured ---\n'
printf 'TRIGGER=%s\n' "$TRIGGER"
printf 'POPUP_TEXT=%s\n' "$POPUP_TEXT"
printf 'EXT_ENABLED=%s\n' "$EXT_ENABLED"
printf 'SITE_ACCESS=%s\n' "$SITE_ACCESS"
printf 'CONSOLE_ERRORS=%s\n' "$CONSOLE_ERRORS"
printf 'AFTER_RELOAD=%s\n' "$AFTER_RELOAD"
