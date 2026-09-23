// Regression loop for: "the bottom-right summary pane doesn't come up when I
// summarize comments."
//
// Loads the REAL content.js into a jsdom page (Reddit fixture), stubs the
// WebExtension `browser` API the way Safari/Firefox expose it, delivers the
// same {type:"start"} message the toolbar popup / ⌘⌥S shortcut sends, and
// asserts that #cs-card is attached to the document *and* carries the
// bottom-right fixed styling that makes it perceivable.
//
// Bug this locks down: ensureCard() used a one-way `styleInjected` flag. If the
// page (or Safari) removed the injected <style> node, the next summarize
// re-created the card with NO styling — an unstyled div at the end of <html>,
// i.e. no visible floating pane — while the toolbar popup still reported
// "Working… watch the card on the page".
//
// Usage (from the repo root):
//   npm i --no-save jsdom            # one-time, if not already installed
//   node tools/extension-card-loop.mjs                                  # expect GREEN
//   node tools/extension-card-loop.mjs --scenario=page-wipes-injected-nodes
//   node tools/extension-card-loop.mjs --break=no-inject                # expect RED
//   node tools/extension-card-loop.mjs --break=no-append                # expect RED
//
// Exit 0 = pane appeared (symptom absent). Exit 1 = symptom reproduced.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = await import("jsdom"));
} catch {
  console.error("This loop needs jsdom. Install it once with:");
  console.error("    npm i --no-save jsdom");
  console.error("or run with NODE_PATH pointing at a node_modules that has jsdom.");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
// The copy that ships inside the app; keep extension/content.js identical.
const SRC = resolve(
  here,
  "../Comment Summarizer/Comment Summarizer Extension/Resources/content.js",
);

const arg = (name) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1] || "";
const breakMode = arg("break");
const scenario = arg("scenario");

// --- fixture: a Reddit thread page (only the card path matters; comment
// extraction is allowed to find 0 comments and still shows the card) ---
const FIXTURE = `<!doctype html><html><head><title>t</title></head><body>
  <shreddit-comment depth="0"><div slot="comment">first comment body</div></shreddit-comment>
  <shreddit-comment depth="0"><div slot="comment">second comment body</div></shreddit-comment>
</body></html>`;

const virtualConsole = new VirtualConsole();
const consoleErrors = [];
virtualConsole.on("jsdomError", (e) => consoleErrors.push(String(e && e.message)));
virtualConsole.on("error", (...a) => consoleErrors.push(a.map(String).join(" ")));

const dom = new JSDOM(FIXTURE, {
  url: "https://www.reddit.com/r/example/comments/abc123/a_post/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;

// --- WebExtension API stub (promise-based, like Safari's `browser`) ---
const messageListeners = [];
const runtimeErrors = [];
const browser = {
  runtime: {
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    sendMessage: async () => {},
    connect: () => ({
      onMessage: { addListener() {} },
      onDisconnect: { addListener() {} },
      postMessage() {},
      disconnect() {},
    }),
    getURL: (p) => `safari-web-extension://loop/${p}`,
    lastError: null,
  },
  storage: {
    local: {
      get: async () => ({
        provider: "ollama",
        model: "llama3.1",
        maxComments: 300,
        sites: ["reddit", "youtube"],
        timeoutSec: 60,
        redditPerThread: 20,
        redditMaxDepth: 3,
      }),
      set: async () => {},
    },
    onChanged: { addListener() {} },
  },
  tabs: { create: async () => {}, sendMessage: async () => {} },
};
window.browser = browser;
window.chrome = browser;
window.addEventListener("error", (e) => runtimeErrors.push(String(e.message)));

// --- load the real content script ---
let src = readFileSync(SRC, "utf8");
if (breakMode === "no-inject") {
  // Simulate the content script never being injected / its listener never
  // registering (the environmental failure mode).
  src = src.replace("browser.runtime.onMessage.addListener(", "(function(){})(");
} else if (breakMode === "no-append") {
  // Simulate the card being built but never attached to the page.
  src = src.replace("document.documentElement.appendChild(cardEl);", "");
}

let loadError = null;
try {
  window.eval(src);
} catch (e) {
  loadError = e;
}

const doc = window.document;
const summarize = () => {
  if (!messageListeners.length) return;
  messageListeners[0]({ type: "start" }, {}, () => {});
};
const settle = () => new Promise((r) => setTimeout(r, 150));

// What the user actually perceives: the pane exists, is attached, and is
// styled as a fixed bottom-right floating panel.
const snapshot = () => {
  const card = doc.getElementById("cs-card");
  const attached = !!(card && doc.documentElement.contains(card));
  const styleText = [...doc.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  const styled = /#cs-card\s*\{[^}]*position:\s*fixed[^}]*right:\s*16px[^}]*bottom:\s*16px/s.test(
    styleText,
  );
  const status = card ? ((card.querySelector(".cs-status") || {}).textContent || "").trim() : "";
  return { card, attached, styled, status };
};

summarize();
await settle();
const before = snapshot();

// --- scenario: the page wipes nodes the extension injected (SPA re-render,
// framework cleanup, another extension, Safari recycling the content script).
// This is the regression: the re-created card must come back styled. ---
let wiped = null;
if (scenario === "page-wipes-injected-nodes") {
  for (const s of [...doc.querySelectorAll("style")]) s.remove();
  const c = doc.getElementById("cs-card");
  if (c) c.remove();
  wiped = snapshot();
  summarize();
  await settle();
}

const after = snapshot();
const observed = scenario ? after : before;
const ok = observed.attached && observed.styled && !loadError;

console.log(`mode=${breakMode || scenario || "as-is"}`);
console.log(`  content.js evaluated without throwing : ${loadError ? "NO — " + loadError : "yes"}`);
console.log(`  runtime.onMessage listeners registered : ${messageListeners.length}`);
console.log(`  #cs-card attached to the page         : ${observed.attached ? "yes" : "NO"}`);
console.log(`  styled fixed right/bottom 16px        : ${observed.styled ? "yes" : "NO"}`);
if (observed.status) console.log(`  card status text                      : ${JSON.stringify(observed.status)}`);
console.log(
  `  first summarize                       : attached=${before.attached ? "y" : "n"} styled=${before.styled ? "y" : "n"}`,
);
if (wiped) {
  console.log(`  after page wiped injected nodes       : cardGone=${!wiped.attached} styleGone=${!wiped.styled}`);
  console.log(
    `  second summarize                      : attached=${after.attached ? "y" : "n"} styled=${after.styled ? "y" : "n"}`,
  );
}
if (consoleErrors.length) console.log(`  jsdom errors                          : ${consoleErrors.slice(0, 3).join(" | ")}`);
if (runtimeErrors.length) console.log(`  page errors                           : ${runtimeErrors.slice(0, 3).join(" | ")}`);
console.log(
  `RESULT: ${ok ? "GREEN — pane appeared (symptom absent)" : "RED — pane did NOT appear (symptom reproduced)"}`,
);
process.exit(ok ? 0 : 1);
