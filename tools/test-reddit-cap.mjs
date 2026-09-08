// Regression test for the Reddit "per-thread cap" fix in extension/content.js.
//
// Bug: Reddit's shreddit UI renders each top-level comment's reply chain as a
// contiguous run of shreddit-comment elements, so a plain DOM-order walk lets
// one huge off-topic top thread fill the whole maxComments budget and the
// summary describes only that tangent.
//
// Fix: capRedditByThread() keeps at most REDDIT_MAX_PER_THREAD comments per
// top-level thread (thread root + its replies) while preserving DOM order.
//
// This runner extracts the REAL capRedditByThread function out of
// extension/content.js and exercises it against fake DOM trees (nested and flat
// reply layouts). Run:  node tools/test-reddit-cap.mjs
//
// Note: DOM *glue* (querySelectorAll order) is not covered here — verify once
// in a live browser on a real thread.

import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(root, "extension", "content.js"), "utf8");

// Pull the real function (plus the default constant it falls back to) out of
// the content script. capRedditByThread sits right before extractRedditComments,
// so that boundary marks the end of the slice.
const start = src.indexOf("const REDDIT_MAX_PER_THREAD");
const end = src.indexOf("\n  function extractRedditComments", start);
if (start === -1 || end === -1) {
  console.error("Could not locate capRedditByThread in content.js");
  process.exit(1);
}
const fnSource = src.slice(start, end);
const context = { parseInt, Math };
vm.createContext(context);
vm.runInContext(`${fnSource}\n;globalThis.__cap = capRedditByThread;`, context);
const cap = context.__cap;

// --- tiny fake DOM ---
function makeComment(depth, name) {
  return {
    tag: "shreddit-comment",
    depth, // undefined => attribute absent
    name,
    parent: null,
    children: [],
    get parentElement() {
      return this.parent;
    },
    get tagName() {
      return this.tag.toUpperCase(); // real custom elements expose an uppercase tagName
    },
    getAttribute(n) {
      return n === "depth" && this.depth !== undefined ? String(this.depth) : null;
    },
    closest(sel) {
      // Real closest() includes the element itself; the extractor calls it on
      // parentElement, so starting at `this` mirrors el.parentElement.closest().
      let n = this;
      while (n) {
        if (n.tag === sel) return n;
        n = n.parent;
      }
      return null;
    },
  };
}
function parentOf(el, p) {
  el.parent = p;
  if (p) p.children.push(el);
  return el;
}
function docOrder(els) {
  const out = [];
  const walk = (list) => {
    for (const e of list) {
      out.push(e);
      walk(e.children);
    }
  };
  walk(els);
  return out;
}
function addThread(threads, root, replies, replyDepthOf, nested) {
  // Attach replies to the thread root. `nested: false` keeps them flat siblings
  // (no shreddit-comment ancestor); `nested: true` hangs each new reply under
  // the previous one (a shreddit-comment ancestor chain), like a deep thread.
  threads.push(root);
  for (let i = 0; i < replies; i++) {
    const d = replyDepthOf ? replyDepthOf(i) : 1;
    const parent = !nested || i === 0 ? root : root.children[root.children.length - 1];
    parentOf(makeComment(d, `${root.name}/r${i}`), parent);
  }
}

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`  ok: ${label}`);
  else {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

// --- Scenario 1: nested layout, giant tangent top thread ---
console.log("\nScenario 1 — nested layout; 400-reply off-topic tangent top thread");
{
  const threads = []; // top-level roots, in display order
  const t1 = makeComment(0, "T1-tangent");
  addThread(threads, t1, 400, (i) => 1 + (i % 4), true); // deep nested replies
  const t2 = makeComment(0, "T2");
  addThread(threads, t2, 6, null, true);
  const t3 = makeComment(0, "T3");
  addThread(threads, t3, 2, null, true);
  for (let i = 4; i <= 40; i++) threads.push(makeComment(0, `T${i}`)); // lone roots

  const picked = cap(docOrder(threads), 30);
  const perThread = {};
  for (const p of picked) perThread[p.name.split("/")[0]] = (perThread[p.name.split("/")[0]] || 0) + 1;

  check(perThread["T1-tangent"] === 30, "tangent thread capped at 30 (had 400 replies)");
  check(perThread.T2 === 7, "T2 keeps all 7 of its comments (under cap)");
  check(perThread.T3 === 3, "T3 keeps all 3 of its comments (under cap)");
  check(perThread.T4 === 1 && perThread.T40 === 1, "lone top-level roots each keep 1");
  check(picked.length === 30 + 7 + 3 + 37, `total picked = ${picked.length} (expect 77)`);
  check(picked[0].name === "T1-tangent" && picked[30].name === "T2", "tangent's own root leads, then next thread");
  // Global maxComments=300 budget applied afterwards must no longer be tangent-only.
  const slice300 = picked.slice(0, 300);
  const tangentShare = slice300.filter((p) => p.name.startsWith("T1-tangent")).length;
  check(tangentShare === 30, `of the 300-comment budget only ${tangentShare} come from the tangent`);
}

// --- Scenario 2: flat (non-nested) reply layout ---
console.log("\nScenario 2 — flat sibling layout (replies follow their root, depth attr present)");
{
  const els = [];
  const root = makeComment(0, "R1");
  els.push(root);
  for (let i = 0; i < 300; i++) els.push(makeComment(1, `R1/r${i}`)); // flat siblings
  const root2 = makeComment(0, "R2");
  els.push(root2);
  for (let i = 0; i < 5; i++) els.push(makeComment(1, `R2/r${i}`));
  const root3 = makeComment(0, "R3");
  els.push(root3);

  const picked = cap(els, 30);
  check(picked.length === 37, `flat layout: 30 + 6 + 1 = ${picked.length} (expect 37)`);
  check(picked[30].name === "R2", "after the capped R1 run, R2's thread starts");
}

// --- Scenario 3: no depth attributes anywhere (nested markup) ---
console.log("\nScenario 3 — depth attribute absent; nested markup");
{
  const roots = [];
  const r1 = makeComment(undefined, "noDepth-1");
  roots.push(r1);
  // nested replies without depth attrs (they have a shreddit-comment ancestor)
  for (let i = 0; i < 50; i++) parentOf(makeComment(undefined, `noDepth-1/r${i}`), i === 0 ? r1 : r1.children[r1.children.length - 1]);
  const r2 = makeComment(undefined, "noDepth-2");
  roots.push(r2);

  const picked = cap(docOrder(roots), 30);
  const g1 = picked.filter((p) => p.name.startsWith("noDepth-1")).length;
  const g2 = picked.filter((p) => p.name.startsWith("noDepth-2")).length;
  check(g1 === 30 && g2 === 1 && picked.length === 31, `no-depth nested chain capped at 30 (got ${g1}), next root kept (${g2})`);
}

// --- Scenario 4: the cap is configurable (popup "Max comments per thread") ---
console.log("\nScenario 4 — per-thread cap honors a user-supplied value");
{
  const threads = [];
  const big = makeComment(0, "Big");
  addThread(threads, big, 200, null, true); // 200 nested replies
  threads.push(makeComment(0, "Lone"));

  for (const [setting, expectBig, expectTotal] of [
    [5, 5, 6],
    [30, 30, 31],
    [100, 100, 101],
  ]) {
    const picked = cap(docOrder(threads), setting);
    const bigCount = picked.filter((p) => p.name === "Big" || p.name.startsWith("Big/")).length;
    check(
      bigCount === expectBig && picked.length === expectTotal,
      `perThread=${setting}: big thread contributes ${bigCount} (expect ${expectBig}), total ${picked.length} (expect ${expectTotal})`,
    );
  }

  // Absent/invalid setting falls back to the default (30), matching a fresh user
  // who hasn't opened the popup yet.
  for (const setting of [undefined, null, "abc", NaN]) {
    const picked = cap(docOrder(threads), setting);
    const bigCount = picked.filter((p) => p.name === "Big" || p.name.startsWith("Big/")).length;
    check(bigCount === 30, `unset/invalid perThread (${String(setting)}) falls back to default 30 (got ${bigCount})`);
  }
}

// --- Scenario 5: max reply depth (attr-based + nested fallback) ---
console.log("\nScenario 5 — max reply depth (depth=\"N\" attrs; 0 = top-level only)");
{
  // Two threads with explicit depth attributes, nested for realism:
  //   Big:    R(d0), rA(d1), rA1(d2), rA2(d3), rB(d1), rB1(d2)
  //   Small:  S(d0), sA(d1), sB(d1)
  const roots = [];
  const R = makeComment(0, "R");
  roots.push(R);
  const rA = parentOf(makeComment(1, "rA"), R);
  const rA1 = parentOf(makeComment(2, "rA1"), rA);
  parentOf(makeComment(3, "rA2"), rA1);
  const rB = parentOf(makeComment(1, "rB"), R);
  parentOf(makeComment(2, "rB1"), rB);
  const S = makeComment(0, "S");
  roots.push(S);
  parentOf(makeComment(1, "sA"), S);
  parentOf(makeComment(1, "sB"), S);
  const all = docOrder(roots);
  check(all.length === 9, `fixture has ${all.length} comments (expect 9)`);

  const names = (picked) => picked.map((p) => p.name).join(",");

  let p = cap(all, 30, 0);
  check(names(p) === "R,S", `depth 0 keeps only top-level comments (got: ${names(p)})`);

  p = cap(all, 30, 1);
  check(names(p) === "R,rA,rB,S,sA,sB", `depth 1 keeps direct replies (got: ${names(p)})`);

  p = cap(all, 30, 2);
  check(names(p) === "R,rA,rA1,rB,rB1,S,sA,sB", `depth 2 excludes the d3 comment (got: ${names(p)})`);

  p = cap(all, 30, null);
  check(p.length === 9, `no depth limit keeps all ${p.length} (expect 9)`);

  // Both knobs together: Big is capped at its 4 shallowest comments (depth<=2),
  // then Small contributes fully.
  p = cap(all, 4, 2);
  check(
    names(p) === "R,rA,rA1,rB,S,sA,sB",
    `perThread=4 + depth=2 → Big capped at 4 shallowest, Small kept (got: ${names(p)})`,
  );
  check(p.length === 7, `combined caps yield ${p.length} comments (expect 7)`);
}

console.log("\nScenario 6 — max reply depth without depth attrs (ancestor-count fallback)");
{
  // A deep no-attr chain: each reply nests under the previous one.
  const root = makeComment(undefined, "L0");
  let parent = root;
  for (let i = 1; i <= 5; i++) parent = parentOf(makeComment(undefined, `L${i}`), parent);
  const all = docOrder([root]);
  check(all.length === 6, `chain fixture has ${all.length} comments (expect 6)`);

  const names = (picked) => picked.map((p) => p.name).join(",");
  check(names(cap(all, 30, 0)) === "L0", "depth 0 keeps only the root");
  check(names(cap(all, 30, 1)) === "L0,L1", "depth 1 keeps root + first reply");
  check(names(cap(all, 30, 2)) === "L0,L1,L2", "depth 2 keeps root + 2 reply levels");
  check(cap(all, 30, null).length === 6, "no depth limit keeps the whole chain");
  // Skipping deep comments must not consume the per-thread budget:
  check(names(cap(all, 5, 2)) === "L0,L1,L2", "deep skips don't spend the per-thread budget");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
