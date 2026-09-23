#!/usr/bin/env bash
# Red-capable verification for the App Store rejection (Guideline 2.1(a)):
#   "No Action occurs when the user selects 'Quit and Open Safari Extension Preferences…'"
#
# Root cause being verified: ViewController.swift called the Safari web
# extension APIs with the Xcode-template placeholder bundle identifier
# (com.example.commentsummarizer.Extension) instead of the real one
# declared in project.pbxproj. With an identifier the system does not
# recognise, recent macOS neither opens the settings pane nor invokes the
# completion handlers, so the button appeared dead (and the extension
# state in the app window could never be shown).
#
# Checks (all must pass -> GREEN):
#   A. no com.example.* placeholder remains in ViewController.swift
#   B. the extension identifier used matches the pbxproj ground truth
#      (hardcoded) or is discovered from the bundled .appex at runtime
#   C. the open-preferences path guarantees app termination via a timed
#      fallback in case SFSafariApplication never calls back
#   D. a fallback (x-apple.systempreferences URL) opens the settings pane
#      when showPreferencesForExtension fails
#   E. the message handler still routes "open-preferences" to
#      showPreferencesForExtension
#
# NOTE: this verifies the root-cause conditions statically. The full
# end-to-end (click -> settings pane opens -> app quits) must additionally
# be confirmed on a macOS runtime (Xcode run on a Mac); see PROGRESS.md.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VC="$ROOT/Comment Summarizer/Comment Summarizer/ViewController.swift"
PBX="$ROOT/Comment Summarizer/Doxa Comment Summarizer.xcodeproj/project.pbxproj"

[ -f "$VC" ]  || { echo "ABORT: missing $VC"; exit 2; }
[ -f "$PBX" ] || { echo "ABORT: missing $PBX"; exit 2; }

fail=0
check() { # $1 = description, $2 = 1 pass / 0 fail
  if [ "$2" -eq 1 ]; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi
}

# Ground truth: extension target PRODUCT_BUNDLE_IDENTIFIER from the project.
EXT_ID=$(grep -o 'PRODUCT_BUNDLE_IDENTIFIER = [^;]*' "$PBX" \
  | sed 's/.*= //; s/;//' | grep '\.Extension$' | head -1)
[ -n "${EXT_ID:-}" ] || { echo "ABORT: extension bundle id not found in pbxproj"; exit 2; }
echo "ground-truth extension bundle id (pbxproj): $EXT_ID"

# A. no placeholder identifier left in the app source (quoted string form,
#    so mentions in comments do not trip the check)
if grep -qE '"com\.example' "$VC"; then
  check "A: no com.example.* placeholder in ViewController.swift" 0
else
  check "A: no com.example.* placeholder in ViewController.swift" 1
fi

# B. identifier matches ground truth or is discovered from the bundled appex
if grep -qF "\"$EXT_ID\"" "$VC"; then
  check "B: extension id is the real one (hardcoded or discovered from Contents/PlugIns)" 1
elif grep -qE 'contentsOfDirectory.*PlugIns' "$VC" && grep -qE 'com\.apple\.Safari\.web-extension' "$VC"; then
  check "B: extension id is the real one (hardcoded or discovered from Contents/PlugIns)" 1
else
  check "B: extension id is the real one (hardcoded or discovered from Contents/PlugIns)" 0
fi

# C. termination guaranteed even if the Safari API never calls back
if grep -qE 'DispatchWorkItem|asyncAfter|Timer\.scheduled' "$VC"; then
  check "C: timed fallback guarantees the app quits (button can never appear dead)" 1
else
  check "C: timed fallback guarantees the app quits (button can never appear dead)" 0
fi

# D. settings pane opened via URL scheme when the Safari API fails
if grep -q 'x-apple\.systempreferences' "$VC" && grep -q 'NSWorkspace' "$VC"; then
  check "D: fallback opens the Settings pane via x-apple.systempreferences URL" 1
else
  check "D: fallback opens the Settings pane via x-apple.systempreferences URL" 0
fi

# E. original behaviour intact
if grep -q 'open-preferences' "$VC" && grep -q 'showPreferencesForExtension' "$VC"; then
  check "E: controller handler still calls showPreferencesForExtension for open-preferences" 1
else
  check "E: controller handler still calls showPreferencesForExtension for open-preferences" 0
fi

if [ "$fail" -eq 0 ]; then
  echo "RESULT: GREEN — all checks pass (static verification of the root cause + fallbacks)"
else
  echo "RESULT: RED — failures listed above"
fi
exit $fail
