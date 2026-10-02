// Regression test for the "which sites count as Lemmy?" UI in the popup.
//
// Doxa treats a page as Lemmy only when BOTH the hostname is on the instance list
// AND the path is /post/<numeric id>. The built-in half of that list lives in the
// manifest (static) and the user-added half in storage, so the popup is the only
// place a user can see what Doxa will actually act on. This loop renders the real
// popup.html + popup.js in jsdom and asserts the list is shown, complete, and
// collapsible — plus that both copies stay in step.
//
// Run:  node tools/test-lemmy-instances-ui.mjs
// Needs jsdom once: npm i --no-save jsdom

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = await import("jsdom"));
} catch {
  console.error("This loop needs jsdom. Install it once with:\n    npm i --no-save jsdom");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../extension");
const BUNDLE = resolve(here, "../Comment Summarizer/Comment Summarizer Extension/Resources");

const arg = (name) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1] || "";
const BREAK = arg("break");

let failures = 0;
function ok(cond, label, detail = "") {
  if (cond) console.log("  PASS " + label);
  else {
    failures++;
    console.error("  FAIL " + label + (detail ? ` — ${detail}` : ""));
  }
}

// --- the expected built-in set, read from the manifest rather than hardcoded ---
const manifest = JSON.parse(readFileSync(resolve(SRC, "manifest.json"), "utf8"));
const declared = manifest.content_scripts[0].matches
  .filter((m) => !m.includes("reddit.com") && !m.includes("youtube.com"))
  .map((m) => m.replace(/^\*:\/\//, "").replace(/\/\*$/, ""));

async function openPopup(customInstances) {
  const html = readFileSync(resolve(SRC, "popup.html"), "utf8");
  let js = readFileSync(resolve(SRC, "popup.js"), "utf8");

  // Deliberate breaks, to prove this loop can go red.
  if (BREAK === "hide-list") js = js.replace("els.lemmyList.appendChild(row);", "");
  if (BREAK === "drop-count") js = js.replace("if (els.lemmyCount) {", "if (false) {");

  const virtualConsole = new VirtualConsole();
  const pageErrors = [];
  virtualConsole.on("jsdomError", (e) => pageErrors.push(String(e && e.message)));

  const dom = new JSDOM(html, {
    url: "moz-extension://doxa/popup.html",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;

  const browser = {
    runtime: {
      getManifest: () => ({ version: "9.9.9" }),
      sendMessage: async () => ({}),
      getBrowserInfo: async () => ({ name: "Firefox", version: "142.0" }),
      onMessage: { addListener() {} },
    },
    storage: {
      local: {
        get: async () => ({
          provider: "ollama",
          model: "llama3.1",
          ollamaUrl: "http://localhost:11434",
          maxComments: 300,
          redditPerThread: 30,
          sites: ["reddit", "youtube", "lemmy"],
          lemmyInstances: customInstances,
          timeoutSec: 60,
        }),
        set: async () => {},
        remove: async () => {},
      },
      onChanged: { addListener() {} },
    },
    tabs: {
      query: async () => [{ url: "https://lemmy.world/post/11967676" }],
      create: async () => {},
      sendMessage: async () => {},
    },
    permissions: { request: async () => true },
  };
  window.browser = browser;
  window.chrome = browser;

  try {
    window.eval(js);
  } catch (e) {
    pageErrors.push(String(e && e.message));
  }
  // init() is async; flush microtasks so loadSettings/render have run.
  await new Promise((r) => setTimeout(r, 0));
  return { window, doc: window.document, pageErrors };
}

console.log("\nLemmy instance visibility in the popup");

{
  const { doc, window, pageErrors } = await openPopup(["lemmy.example.org"]);
  ok(pageErrors.length === 0, "popup evaluated without throwing", pageErrors[0]);

  const rows = [...doc.querySelectorAll("#lemmyList .lemmy-instance span:first-child")].map(
    (s) => s.textContent,
  );
  ok(rows.length > 0, "the instance list renders rows at all");
  ok(
    declared.every((h) => rows.includes(h)),
    "every manifest-declared instance is listed in the popup",
    `declared ${declared.length}, rendered ${rows.filter((r) => declared.includes(r)).length}`,
  );
  ok(
    declared.length >= 10,
    "the built-in allowlist is non-trivial",
    `${declared.length} declared`,
  );
  ok(rows.includes("lemmy.example.org"), "a user-added instance appears too");

  const builtinTags = [...doc.querySelectorAll("#lemmyList .lemmy-tag")];
  ok(
    builtinTags.length === declared.length,
    "built-ins are labelled so they read as non-removable",
    `${builtinTags.length} tags vs ${declared.length} built-ins`,
  );
  const removeBtns = [...doc.querySelectorAll("#lemmyList button")];
  ok(
    removeBtns.length === 1,
    "only user-added instances get a Remove control",
    `${removeBtns.length} buttons`,
  );
  ok(removeBtns[0]?.previousSibling?.textContent === "lemmy.example.org", "Remove sits next to the added host");

  const count = doc.querySelector("#lemmyCount");
  ok(!!count && /\d+\s+instances/.test(count.textContent), "a total count is shown", count?.textContent);
  ok(
    count.textContent.includes(String(declared.length + 1)),
    "count includes built-ins plus added",
    count.textContent,
  );

  const list = doc.querySelector("#lemmyList");
  const toggle = doc.querySelector("#lemmyToggleBtn");
  ok(list.classList.contains("collapsed"), "list starts collapsed so ten rows don't flood the popup");
  ok(!!toggle && /Show included/i.test(toggle.textContent), "there is an explicit show/hide control");

  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  ok(!list.classList.contains("collapsed"), "clicking the control reveals the list");
  ok(/Hide included/i.test(toggle.textContent), "control relabels after expanding");
  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  ok(list.classList.contains("collapsed"), "clicking again collapses it");
}

{
  const { doc } = await openPopup([]);
  const rows = [...doc.querySelectorAll("#lemmyList .lemmy-instance")];
  ok(rows.length === declared.length, "with no custom instances, only built-ins render", `${rows.length}`);
  ok(doc.querySelectorAll("#lemmyList button").length === 0, "nothing offers Remove for a built-in");
}

console.log("\nBoth channels ship the same thing");
for (const f of ["popup.js", "popup.html", "popup.css"]) {
  const a = readFileSync(resolve(SRC, f), "utf8");
  const b = readFileSync(resolve(BUNDLE, f), "utf8");
  ok(a === b, `${f} identical in the Safari bundle`);
  ok(a.includes("LEMMY_INSTANCES") || f !== "popup.js", "popup.js keeps the instance list");
}
const bundleManifest = JSON.parse(readFileSync(resolve(BUNDLE, "manifest.json"), "utf8"));
ok(
  JSON.stringify(bundleManifest.content_scripts[0].matches) ===
    JSON.stringify(manifest.content_scripts[0].matches),
  "both manifests declare the same content-script matches",
);

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("GREEN — the popup shows exactly which sites Doxa treats as Lemmy");
