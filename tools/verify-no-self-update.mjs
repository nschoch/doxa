// Regression loop for App Store guideline 2.4.5(vii):
//
//   "The app updates itself outside of the Mac App Store." — App Review,
//   submission 1.0 (build 24), 2025-09-25, with a screenshot of the Doxa popup.
//
// What the reviewer actually saw: the popup footer's "Check for updates" link
// and the amber "Update available" banner, both driven by a GitHub Releases
// check (api.github.com). The macOS app itself has no updater — but the bundled
// Safari extension shipped one, and that is what the store build must not have.
//
// This loop loads the REAL extension/popup.js (and the real popup.html markup)
// into a jsdom popup and drives it as both runtimes:
//
//   SAFARI (what App Review runs) — the updater must be completely dormant:
//     no "Check for updates" link shown, no banner, and NO check-update message
//     to the background (which is the only caller of api.github.com).
//   FIREFOX (self-hosted .xpi)  — the updater must still work: one check on
//     popup open, and the banner appears when the background reports a newer
//     release.
//
// Usage (from the repo root):
//   npm i --no-save jsdom                                          # one-time
//   node tools/verify-no-self-update.mjs                           # expect GREEN
//   node tools/verify-no-self-update.mjs --break=always-enabled    # expect RED
//   node tools/verify-no-self-update.mjs --break=never-enabled     # expect RED
//   node tools/verify-no-self-update.mjs --break=banner-on-load    # expect RED
//   node tools/verify-no-self-update.mjs --break=no-refuse         # expect RED
//
// Exit 0 = store build shows no self-update surface. Exit 1 = symptom present.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = await import("jsdom"));
} catch {
  console.error("This loop needs jsdom. Install it once with:");
  console.error("    npm i --no-save jsdom");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1] || "";
const BREAK = arg("break");

// The shipped Safari copy is authoritative; extension/ is the source of truth
// for the Firefox build.
const BUNDLE = resolve(
  here,
  "../Comment Summarizer/Comment Summarizer Extension/Resources",
);
const SRC = resolve(here, "../extension");

const failures = [];
const checks = [];
const ok = (name, cond, detail = "") => {
  checks.push({ name, pass: !!cond, detail });
  if (!cond) failures.push(detail ? `${name} — ${detail}` : name);
};

// --- Apply a deliberate break so the loop is provably red-capable ---
function breakGate(code, browserIsSafari) {
  if (!BREAK) return code;
  if (BREAK === "always-enabled") {
    return code.replace(
      /function updatesSupportedInThisBrowser\(\) \{/,
      "function updatesSupportedInThisBrowser() { return true;",
    );
  }
  if (BREAK === "never-enabled") {
    return code.replace(
      /function updatesSupportedInThisBrowser\(\) \{/,
      "function updatesSupportedInThisBrowser() { return false;",
    );
  }
  if (BREAK === "banner-on-load") {
    // Safari-only regression; Firefox keeps its real banner path.
    if (!browserIsSafari) return code;
    // Simulate the rejected behaviour: an update banner painted unconditionally
    // on popup open, exactly what the reviewer's screenshot showed. The
    // "// Non-blocking" comment identifies init()'s gate (bind()'s has none).
    const mutated = code.replace(
      "if (UPDATES_ENABLED) {\n    // Non-blocking",
      "if (UPDATES_ENABLED || true) {\n    els.updateBanner.classList.remove('hidden');\n    // Non-blocking",
    );
    if (mutated === code) {
      throw new Error("--break=banner-on-load did not apply: init() gate not found");
    }
    return mutated;
  }
  if (BREAK === "no-refuse") return code; // background-only sabotage
  throw new Error(`unknown --break=${BREAK}`);
}

// --- A popup page: real markup + real popup.js + a browser stub ---
function makePage(browser) {
  const html = readFileSync(resolve(SRC, "popup.html"), "utf8");
  const virtualConsole = new VirtualConsole();
  const pageErrors = [];
  virtualConsole.on("jsdomError", (e) => pageErrors.push(String(e && e.message)));

  const dom = new JSDOM(html, {
    url: "safari-web-extension://doxa/popup.html",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;

  const messages = [];
  window.browser = {
    runtime: {
      getManifest: () => ({ version: "1.2.2" }),
      sendMessage: async (msg) => {
        messages.push(msg);
        if (msg && msg.type === "check-update") {
          return {
            ok: true,
            current: "1.2.2",
            available: true,
            latest: { version: "9.9.9", url: "https://example.invalid/release" },
          };
        }
        return { ok: true };
      },
      ...(browser.getBrowserInfo ? { getBrowserInfo: browser.getBrowserInfo } : {}),
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
    },
    tabs: {
      query: async () => [{ url: "https://www.reddit.com/r/example/comments/abc/" }],
      create: async () => ({}),
      sendMessage: async () => ({}),
    },
  };
  window.fetch = async () => {
    throw new Error("network disabled in this loop");
  };

  const code = breakGate(readFileSync(resolve(SRC, "popup.js"), "utf8"), !!browser.wasSafari);
  window.eval(code);
  return { window, messages, pageErrors };
}

const get = (window, id) => window.document.getElementById(id);
const shown = (window, id) => {
  const el = get(window, id);
  return !!el && !el.classList.contains("hidden");
};

// The popup's init() is async; wait for it to settle, then let any state update
// triggered by a check-for-update reply land.
const settle = async (ms = 150) =>
  new Promise((r) => setTimeout(r, ms));

// --- Safari: the store build ---
async function safariRun() {
  const { window, messages, pageErrors } = makePage({ wasSafari: true });
  await settle();

  ok(
    "safari: popup scripts evaluate without errors",
    pageErrors.length === 0,
    pageErrors.join(" | "),
  );
  ok(
    "safari: no check-update message reaches the background (no api.github.com caller)",
    !messages.some((m) => m && m.type === "check-update"),
    `sent: ${JSON.stringify(messages)}`,
  );
  ok(
    'safari: the "Check for updates" link is hidden',
    !shown(window, "checkUpdatesLink"),
  );
  ok('safari: the "Update available" banner stays hidden', !shown(window, "updateBanner"));
  ok(
    "safari: the installed version is still shown (the objection was the updater, not the label)",
    /Doxa v1\.2\.2/.test(get(window, "versionLabel").textContent),
    get(window, "versionLabel").textContent,
  );
  ok(
    "safari: the rest of the popup still initialises",
    get(window, "summarizeBtn") !== null && get(window, "status") !== null,
  );
  return { window };
}

// --- Firefox: the self-hosted build keeps its updater ---
async function firefoxRun() {
  const { window, messages, pageErrors } = makePage({
    wasSafari: false,
    getBrowserInfo: async () => ({ name: "Firefox", version: "142.0" }),
  });
  await settle();

  ok(
    "firefox: popup scripts evaluate without errors",
    pageErrors.length === 0,
    pageErrors.join(" | "),
  );
  const checks = messages.filter((m) => m && m.type === "check-update");
  ok(
    "firefox: popup still asks the background to check on open",
    checks.length === 1 && checks[0].force === false,
    `sent: ${JSON.stringify(messages)}`,
  );
  ok(
    'firefox: the "Check for updates" link is still offered',
    shown(window, "checkUpdatesLink"),
  );
  ok(
    'firefox: a newer release still raises the "Update available" banner',
    shown(window, "updateBanner"),
    get(window, "updateDetail").textContent,
  );
  return { window };
}

// --- Static check: the bundled Safari copy must not carry a live updater ---
function staticRun() {
  const popup = readFileSync(resolve(BUNDLE, "popup.js"), "utf8");
  const background = readFileSync(resolve(BUNDLE, "background.js"), "utf8");
  const html = readFileSync(resolve(BUNDLE, "popup.html"), "utf8");

  ok(
    "bundle: popup gates the updater on the platform check",
    /const UPDATES_ENABLED = updatesSupportedInThisBrowser\(\);/.test(popup),
  );
  ok(
    "bundle: the auto check on popup open is gated",
    /if \(UPDATES_ENABLED\) \{[\s\S]{0,220}checkForUpdate\(false\)/.test(popup),
  );
  ok(
    "bundle: the check-update message handler refuses when the updater is off",
    /message\.type === "check-update"[\s\S]{0,400}!UPDATES_ENABLED/.test(background),
    "background.js must not reach api.github.com in the store build",
  );
  ok(
    "bundle: the Firefox-only probe is what gates it (getBrowserInfo is absent in Safari)",
    /browser\.runtime\.getBrowserInfo/.test(popup) && /api\.runtime\.getBrowserInfo/.test(background),
  );
  ok(
    "bundle: the popup markup no longer advertises an update check as a store feature",
    /id="checkUpdatesLink"[^>]*title="Firefox builds only/.test(html),
  );
}

// --- Background: the choke point that owns the api.github.com call ---
// background.js registers its message listener on load, so call that listener
// directly and see whether a check-update request would be answered or refused.
async function backgroundRun({ safari }) {
  const listeners = [];
  const calls = [];
  const api = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      onConnect: { addListener: () => {} },
      getURL: (p) => p,
      getManifest: () => ({ version: "1.2.2" }),
      ...(safari ? {} : { getBrowserInfo: async () => ({ name: "Firefox" }) }),
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: { create: async () => ({}), query: async () => [], sendMessage: async () => {} },
  };
  let code = readFileSync(resolve(SRC, "background.js"), "utf8");
  if (BREAK === "always-enabled") {
    code = code.replace(
      /function updatesSupportedInThisBrowser\(\) \{/,
      "function updatesSupportedInThisBrowser() { return true;",
    );
  }
  if (BREAK === "never-enabled") {
    code = code.replace(
      /function updatesSupportedInThisBrowser\(\) \{/,
      "function updatesSupportedInThisBrowser() { return false;",
    );
  }
  if (BREAK === "no-refuse" && safari) {
    // Sabotage: drop the choke point so a check-update request reaches GitHub.
    code = code.replace("if (!UPDATES_ENABLED) {", "if (false) {");
    if (!code.includes("if (false) {")) {
      throw new Error("--break=no-refuse did not apply: choke point not found");
    }
  }

  const virtualConsole = new VirtualConsole();
  const pageErrors = [];
  virtualConsole.on("jsdomError", (e) => pageErrors.push(String(e && e.message)));
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "safari-web-extension://doxa/background.html",
    runScripts: "outside-only",
    virtualConsole,
  });
  const { window } = dom;
  globalThis.browser = api; // background.js resolves the API from the global scope
  window.browser = api;
  window.fetch = (url) => {
    calls.push(String(url));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: "v1.2.3", html_url: "https://example.invalid/r" }),
    });
  };
  globalThis.fetch = window.fetch;
  window.eval(code);

  const handler = listeners[0];
  const answered = await new Promise((res) => {
    const took = handler({ type: "check-update", force: false }, {}, res);
    if (!took) res(null); // synchronous reply (already sent)
    setTimeout(() => res("no-reply"), 200);
  });

  const label = safari ? "safari" : "firefox";
  ok(
    `${label}: background scripts evaluate without errors`,
    pageErrors.length === 0,
    pageErrors.join(" | "),
  );
  if (safari) {
    ok(
      "safari: background refuses check-update instead of calling api.github.com",
      !!answered && answered.ok === false && calls.length === 0,
      `reply=${JSON.stringify(answered)} githubCalls=${JSON.stringify(calls)}`,
    );
  } else {
    ok(
      "firefox: background still performs the GitHub check",
      calls.some((u) => u.includes("api.github.com")),
      `githubCalls=${JSON.stringify(calls)}`,
    );
  }
}

console.log(`Doxa 2.4.5(vii) check — popup self-update surface (break=${BREAK || "none"})`);
console.log(`  source: ${SRC}`);
console.log(`  bundled Safari copy: ${BUNDLE}\n`);

await safariRun();
await firefoxRun();
await backgroundRun({ safari: true });
await backgroundRun({ safari: false });
staticRun();

for (const c of checks) {
  console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.pass || !c.detail ? "" : `\n         ${c.detail}`}`);
}

if (failures.length) {
  console.log(
    `\nRED — ${failures.length} check(s) failed: the Mac App Store build still exposes a self-update surface.`,
  );
  process.exit(1);
}
console.log(
  "\nGREEN — Safari: no update banner, no update link, no GitHub check. Firefox: updater intact.",
);
