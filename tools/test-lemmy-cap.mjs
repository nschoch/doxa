// Regression test for the Lemmy comment adapter in extension/content.js.
//
// Lemmy's API returns a FLAT list of CommentView objects whose nesting lives in
// `comment.path` ("0.7542164.7545715"), not in document order like Reddit's
// shreddit run. capLemmyByThread() must therefore group threads by root id and
// apply the same per-thread / reply-depth caps the Reddit path uses, so one huge
// tangent can't crowd out the rest of the thread (the bug fixed for Reddit in
// commit 6fa3caa's line of work).
//
// This runner extracts the REAL functions out of extension/content.js and feeds
// them fake CommentView objects — no browser, no network. Run:
//   node tools/test-lemmy-cap.mjs
//
// Note: DOM glue (querySelectorAll order, live fetch behaviour) is NOT covered
// here — verify once in a real browser on lemmy.world.

import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(root, "extension", "content.js"), "utf8");

// Slice covers REDDIT_MAX_PER_THREAD + redditDepthLimit (shared with Reddit) and
// every pure Lemmy helper up to the DOM fallback, which needs a document.
const start = src.indexOf("const REDDIT_MAX_PER_THREAD");
const end = src.indexOf("\n  // Fallback source: the comment nodes Lemmy", start);
if (start === -1 || end === -1) {
  console.error("Could not locate the Lemmy helpers in content.js");
  process.exit(1);
}

let failures = 0;
function check(cond, label) {
  if (cond) {
    console.log("  ok   " + label);
  } else {
    failures++;
    console.error("  FAIL " + label);
  }
}

// location.origin is read when building permalinks; stub it like jsdom would.
const context = {
  parseInt,
  Math,
  Number,
  String,
  Array,
  Map,
  Set,
  URL,
  // Mutable like a real page: lemmyEmptyReason reads location.href to tell this
  // instance from a remote one.
  location: { origin: "https://lemmy.world", href: "https://lemmy.world/post/11967676" },
};
vm.createContext(context);
vm.runInContext(
  `${src.slice(start, end)}
;globalThis.__api = {
  LEMMY_INSTANCES, detectLemmyPost, lemmyDepth, lemmyTopLevel,
  capLemmyByThread, commentsFromLemmyViews, lemmyEmptyReason, redditDepthLimit,
};
// Re-evaluable handle: section 5 needs a different location.href, so expose a
// setter the test can call instead of re-running the slice (which would clash
// with the const declarations above).
;globalThis.__setLocation = (href) => { location.href = href; };`,
  context,
);
const A = context.__api;

// --- fake CommentView factory (shape verified against live 0.19.x API) ---
let nextId = 1000;
function view(opts) {
  const id = opts.id || ++nextId;
  return {
    comment: {
      id,
      post_id: opts.postId || 11967676,
      content: opts.text || "default body text here",
      path: opts.path || `0.${id}`,
      deleted: !!opts.deleted,
      removed: !!opts.removed,
    },
    creator: { id: 7, name: "someone" },
    post: { id: opts.postId || 11967676, local: opts.local === undefined ? true : opts.local },
    community: { name: "lemmyworld" },
    counts: { score: opts.score === undefined ? 1 : opts.score },
  };
}
const paths = (out) => out.map((c) => c.text);

console.log("\n1. depth derived from path");
check(A.lemmyDepth("0.100") === 0, 'path "0.100" is top level');
check(A.lemmyDepth("0.100.101") === 1, "one reply level");
check(A.lemmyDepth("0.100.101.102.103") === 3, "four segments = depth 3");
check(A.lemmyDepth("") === 0 && A.lemmyDepth(undefined) === 0, "missing path does not throw");
check(A.lemmyTopLevel("0.100") === true && A.lemmyTopLevel("0.100.101") === false, "top-level test");

console.log("\n2. per-thread cap mirrors the Reddit rule");
{
  // One top-level comment with 400 replies, then 5 lone top-level comments.
  const views = [view({ id: 1, path: "0.1", text: "root one" })];
  for (let i = 0; i < 400; i++) views.push(view({ path: `0.1.${100 + i}`, text: `reply ${i} body` }));
  for (let i = 0; i < 5; i++) views.push(view({ path: `0.9${i}`, text: `top level ${i} body` }));

  const kept = A.capLemmyByThread(views, 30, undefined).kept;
  const texts = paths(A.commentsFromLemmyViews(views, 30, undefined));
  check(kept.length === 1 + 30 + 5, `tangent capped at 30 replies (got ${kept.length})`);
  check(texts.includes("top level 4 body"), "later top-level threads survive the tangent");
  check(!texts.some((t) => /^reply 3[1-9]/.test(t) || /^reply [4-9]\d/.test(t)), "replies past the cap dropped");

  const flat = A.commentsFromLemmyViews(views, 5, undefined);
  check(flat.filter((c) => c.text.startsWith("reply")).length === 5, "configurable cap 5 honored");
  check(A.commentsFromLemmyViews(views, undefined, undefined).length === 1 + 30 + 5, "unset cap falls back to 30");
  check(A.commentsFromLemmyViews(views, "junk", undefined).length === 1 + 30 + 5, "invalid cap falls back to 30");
  check(A.commentsFromLemmyViews(views, 0, undefined).length === 1 + 30 + 5, "cap 0 clamps to the default, not zero");
}

console.log("\n3. reply-depth cap");
{
  const deep = [];
  for (let d = 0; d <= 4; d++) {
    deep.push(view({ path: "0.1" + Array.from({ length: d }, (_, i) => "." + (2 + i)).join(""), text: `depth ${d} body` }));
  }
  check(A.commentsFromLemmyViews(deep, 30, 0).length === 1, "depth 0 keeps only the top-level comment");
  check(A.commentsFromLemmyViews(deep, 30, 1).length === 2, "depth 1 keeps two levels");
  check(A.commentsFromLemmyViews(deep, 30, 2).length === 3, "depth 2 keeps three levels");
  check(A.commentsFromLemmyViews(deep, 30, undefined).length === 5, "absent depth = unlimited");
  check(A.commentsFromLemmyViews(deep, 30, "").length === 5, 'blank depth "" = unlimited');
  check(A.redditDepthLimit(-1) === null, "negative depth treated as unlimited");
}

console.log("\n4. mapping to Doxa's {text,url} shape");
{
  const views = [
    view({ id: 501, text: "first real comment" }),
    view({ id: 502, text: "deleted one", deleted: true }),
    view({ id: 503, text: "removed one", removed: true }),
    view({ id: 504, text: "short" }),
    view({ id: 505, text: "x" }), // below the 3-char floor
    view({ id: 506, text: "  spaced   out\n\n text  " }),
    view({ id: 506, text: "duplicate id body" }), // same id as above -> dropped
    view({ id: 507, text: "first real comment" }), // different id, same text
  ];
  const out = A.commentsFromLemmyViews(views, 30, undefined);
  const texts = paths(out);
  check(!texts.includes("deleted one") && !texts.includes("removed one"), "deleted/removed comments skipped");
  check(!texts.some((t) => t.length <= 3), "sub-three-character bodies dropped");
  check(texts.includes("spaced out text"), "whitespace normalized to single spaces");
  check(texts.filter((t) => t === "first real comment").length === 1, "exact duplicate text deduped");
  check(out[0].url === "https://lemmy.world/comment/501", "permalink is /comment/<id> on this instance");
  check(out.every((c) => typeof c.text === "string" && typeof c.url === "string"), "shape is {text,url}");
}

console.log("\n5. empty-thread diagnosis (federated lag vs genuinely empty)");
{
  context.location.href = "https://lemmy.world/post/11967676";
  const E = A.lemmyEmptyReason;

  check(E(null, []) === "", "no counts -> generic message upstream");
  check(E({ comments: 0 }, []) === "", "counts.comments 0 -> no special reason");
  check(
    /remote instance/.test(E({ comments: 12 }, [])),
    "empty result on a post that has comments blames federation lag",
  );
  check(
    E({ comments: 12 }, [view({})]) === "",
    "non-empty API result means caps discarded everything, not a missing thread",
  );
  context.location.href = "https://other.example/post/1";
  check(
    /returned none/.test(E({ comments: 12 }, [])),
    "page host differing from the instance name reports the API gap",
  );
}

console.log("\n6. instance detection");
{
  check(A.detectLemmyPost("https://lemmy.world/post/11967676")?.postId === "11967676", "bare post url");
  check(A.detectLemmyPost("https://lemmy.world/post/11967676/7542164?sort=Top")?.postId === "11967676", "permalink with query");
  check(A.detectLemmyPost("https://programming.dev/post/42") !== null, "allowlisted instance");
  check(A.detectLemmyPost("https://lemmy.example.org/post/42") === null, "unknown instance rejected");
  check(A.detectLemmyPost("https://lemmy.example.org/post/42", ["lemmy.example.org"])?.postId === "42", "user-added instance accepted");
  check(A.detectLemmyPost("https://lemmy.world/c/lemmyworld") === null, "community page is not a post");
  check(A.detectLemmyPost("https://lemmy.world/u/someone") === null, "profile page is not a post");
  check(A.detectLemmyPost("https://lemmy.world/post/not-a-number") === null, "non-numeric post id rejected");
  check(A.detectLemmyPost("not a url") === null, "garbage href rejected");
  check(A.detectLemmyPost("ftp://lemmy.world/post/1") === null, "non-http scheme rejected");
  check(A.LEMMY_INSTANCES.length === 10, "ten built-in instances");
}

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all Lemmy adapter checks passed");
