// Regression test for linkifying "Sources" citations in the summary card.
//
// Problem: the model often emits source lines as plain "[N] label" without the
// "(permalink)" part, so nothing was clickable. renderCite() now attaches the
// permalink the extension actually collected for that comment number.
//
// Extracts the REAL escapeHtml / inlineMd / renderCite / renderMarkdown out of
// extension/content.js and runs them against fixtures. Run: node tools/test-render-markdown.mjs

import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(root, "extension", "content.js"), "utf8");

const start = src.indexOf("function escapeHtml");
const end = src.indexOf("\n})();", start);
if (start === -1 || end === -1) {
  console.error("Could not locate the markdown helpers in content.js");
  process.exit(1);
}
const context = {};
vm.createContext(context);
vm.runInContext(
  `${src.slice(start, end)}\n;globalThis.__rm = { escapeHtml, inlineMd, renderCite, renderMarkdown };`,
  context,
);
const { renderMarkdown } = context.__rm;

let failures = 0;
function check(cond, label, extra) {
  if (cond) console.log(`  ok: ${label}`);
  else {
    failures++;
    console.error(`FAIL: ${label}${extra ? " — " + extra : ""}`);
  }
}

const URLs = [
  "https://www.reddit.com/r/x/comments/abc/comment/a/",
  "https://www.reddit.com/r/x/comments/abc/comment/b/",
  "https://www.reddit.com/r/x/comments/abc/comment/c/",
];

console.log("\nCase 1 — model omitted the permalink; extension supplies it");
{
  const md = "[1] OP's initial modification concept\n[2] Structural & crash safety constraints";
  const html = renderMarkdown(md, URLs);
  const a1 = html.includes('href="https://www.reddit.com/r/x/comments/abc/comment/a/" target="_blank" rel="noopener">[1] OP');
  const a2 = html.includes('href="https://www.reddit.com/r/x/comments/abc/comment/b/" target="_blank" rel="noopener">[2] Structural');
  check(a1, "[1] line is a link to comment a", html);
  check(a2, "[2] line is a link to comment b", html);
}

console.log("\nCase 2 — model gave its own [permalink](url); leave it as-is");
{
  const md = "[5] OP's stance on AI consent and visual horror [permalink](https://www.reddit.com/r/y/comments/z/xyz/)";
  const html = renderMarkdown(md, URLs);
  check(html.includes('href="https://www.reddit.com/r/y/comments/z/xyz/" target="_blank" rel="noopener">permalink</a>'),
    "model's markdown link preserved (not double-wrapped, link text is \"permalink\")", html);
}

console.log("\nCase 3 — citation number out of range stays plain text");
{
  const html = renderMarkdown("[99] someone hallucinated a source", URLs);
  check(!/href=/.test(html), "out-of-range [99] is not linkified (safe)", html);
}

console.log("\nCase 4 — no comment URLs (e.g. YouTube) → not linkified");
{
  const html = renderMarkdown("[1] a youtube comment", null);
  check(!/href=/.test(html), "without permalinks the line stays plain text", html);
}

console.log("\nCase 5 — hostile permalink is escaped (no attribute breakout)");
{
  const hostile = ["https://ok/a/", 'https://evil.example/" onmouseover="alert(1)//'];
  const html = renderMarkdown("[2] click me", hostile);
  check(!/> onmouseover=/.test(html) && !/onmouseover="alert/.test(html), "no injected handler attribute", html);
  check(html.includes("&quot;"), "quote in the URL escaped to &quot;", html);
}

console.log("\nCase 6 — line that already has its own link is not double-wrapped");
{
  const md = "[3] seen [here](https://example.com/x)";
  const html = renderMarkdown(md, URLs);
  check(html.includes('href="https://example.com/x"'), "uses the model's own link", html);
  check(!html.includes('comment/c/" target="_blank" rel="noopener">[3] seen'), "extension permalink not forced on top", html);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
