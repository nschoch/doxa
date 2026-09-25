// Firefox release prep for Doxa.
//
// Validates the two-channel setup, builds the release zip that gets attached to
// the GitHub Release, and prints the signing + publish steps. It deliberately
// does NOT sign (that needs the AMO credentials in ./doxa-amo.env) and does NOT
// tag or push — those stay with the owner.
//
// Why this exists: `zip` is not on every machine that runs this repo's checks,
// and the old documented command (`cd extension && zip -r … .`) silently
// depended on the working directory *and* on the two manifests being mirrored.
// They must NOT be mirrored: `extension/manifest.json` is the Firefox version
// (drives the add-on's own update banner and must equal the release tag), while
// `Resources/manifest.json` is the Safari/App Store version, which is bumped
// independently so each store build is identifiable.
//
// Usage (from the repo root):
//   node tools/prep-firefox-release.mjs            # validate + build
//   node tools/prep-firefox-release.mjs --check    # validate only, no file written
//
// Exit 0 = release artifact built and consistent. Exit 1 = a check failed.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative, sep } from "node:path";
import { deflateRawSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const SRC = resolve(ROOT, "extension");
const BUNDLE = resolve(ROOT, "Comment Summarizer/Comment Summarizer Extension/Resources");
const CHECK_ONLY = process.argv.includes("--check");

const failures = [];
const warnings = [];
const fail = (m) => failures.push(m);
const warn = (m) => warnings.push(m);

// Files that must be byte-identical between the two channels. The manifests are
// excluded on purpose — see the header.
const SYNCED_FILES = ["content.js", "popup.js", "popup.html", "popup.css", "background.js"];
// App Review builds must not ship a third-party update checker; the gate lives
// in these two files, so shipping them to Firefox keeps the channels identical.
const GATE_FILES = ["popup.js", "background.js"];

const manifestOf = (p) => JSON.parse(readFileSync(p, "utf8"));

// --- 1. versions ---
const ff = manifestOf(resolve(SRC, "manifest.json"));
const safari = manifestOf(resolve(BUNDLE, "manifest.json"));
const version = String(ff.version || "");
const semver = /^\d+\.\d+\.\d+$/;
if (!semver.test(version)) fail(`extension/manifest.json version is not x.y.z: "${version}"`);

const cmp = (a, b) => {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

// --- 2. the two manifests must differ by nothing but version ---
const strip = (m) => JSON.stringify({ ...m, version: "X" }, null, 2);
if (strip(ff) !== strip(safari)) {
  fail(
    "extension/manifest.json and the Safari Resources manifest differ by more than `version` — " +
      "sync the code files, not the manifests (DEVELOPMENT.md → Release process).",
  );
} else {
  console.log(`  ok   manifests differ only by version (firefox ${version} / safari ${safari.version})`);
}
if (cmp(version, safari.version) >= 0) {
  warn(
    `firefox version ${version} is not below the safari version ${safari.version}; ` +
      "the store build is normally ahead. Intentional? fine — just make sure the Safari bump was not lost.",
  );
}

// --- 3. synced code files must be identical ---
for (const f of SYNCED_FILES) {
  const a = resolve(SRC, f);
  const b = resolve(BUNDLE, f);
  if (!existsSync(a) || !existsSync(b)) {
    fail(`${f} missing from ${!existsSync(a) ? "extension/" : "the Safari Resources copy"}`);
    continue;
  }
  if (readFileSync(a).compare(readFileSync(b)) !== 0) {
    fail(`${f} differs between the Firefox and Safari copies — sync it before releasing`);
  }
}
console.log(`  ok   ${SYNCED_FILES.length} synced files identical across both channels`);

// --- 4. the 2.4.5(vii) gate is still in the Firefox copy (no-op there, required in Safari) ---
for (const f of GATE_FILES) {
  const code = readFileSync(resolve(SRC, f), "utf8");
  if (!/updatesSupportedInThisBrowser/.test(code) || !/UPDATES_ENABLED/.test(code)) {
    fail(`${f} lost the platform gate (UPDATES_ENABLED) — see tools/verify-no-self-update.mjs`);
  }
}

// --- 5. no secrets in anything about to be published ---
// The zip is public, so a leaked key would be permanent. Pattern-based and
// deliberately broad; a false positive only costs a rename.
const SECRET_PATTERNS = [
  [/sk-[A-Za-z0-9_-]{16,}/, "OpenAI/OpenRouter-style key"],
  [/AIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key block"],
  [/(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{12,}["']/i, "hardcoded credential"],
];
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith(".")) return []; // dotfiles are excluded from the zip
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
const shipped = walk(SRC);
for (const file of shipped) {
  const text = readFileSync(file);
  if (text.includes(0)) continue; // binary (icons)
  const s = text.toString("utf8");
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(s)) {
      const m = s.match(re);
      const where = s.slice(0, m.index).split("\n").length;
      fail(`possible ${label} in ${relative(ROOT, file)}:${where} — refusing to package it`);
    }
  }
}
console.log(`  ok   scanned ${shipped.length} packaged files for credentials`);

// --- 6. nothing uncommitted in extension/ (the tag must describe the artifact) ---
// Best-effort: skipped when git is unavailable.
try {
  const { execFileSync } = await import("node:child_process");
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "extension/"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (dirty) {
    // The version bump itself is expected to be uncommitted at this point; only
    // other edits make the tag ambiguous.
    const lines = dirty.split("\n").filter((l) => !l.endsWith("extension/manifest.json"));
    if (lines.length) {
      fail(`extension/ has uncommitted changes beyond manifest.json:\n         ${lines.join("\n         ")}`);
    } else {
      console.log("  ok   only extension/manifest.json is dirty (the version bump) — commit it before tagging");
    }
  } else {
    console.log("  ok   extension/ is committed");
  }
} catch {
  warn("could not read git status; skipped the uncommitted-changes check");
}

// --- 7. don't silently overwrite a released artifact ---
const zipPath = resolve(ROOT, `doxa-extension-${version}.zip`);
if (existsSync(zipPath)) warn(`${relative(ROOT, zipPath)} already exists and will be overwritten`);

for (const w of warnings) console.log(`  warn ${w}`);
if (failures.length) {
  console.error(`\nFAILED — ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

if (CHECK_ONLY) {
  console.log("\n--check: validation passed, no artifact written.");
  process.exit(0);
}

// --- build the zip (stored/deflate, root-level entries, dotfiles excluded) ---
// Written by hand because `zip` is not guaranteed to exist; entries are
// deflated when that helps and stored when it doesn't, matching what `zip -r`
// produced for the previous releases.
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

// Deterministic timestamp derived from the version, so rebuilding the same
// version twice produces the same bytes (DOS date/time format).
const [maj, min, pat] = version.split(".").map(Number);
const dosTime = ((maj << 8) | min) & 0xffff;
const dosDate = (((2026 - 1980) << 9) | (pat << 5) | 1) & 0xffff;

const entries = [];
const collect = (dir, prefix = "") => {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    const name = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      entries.push({ name: name + "/", data: null });
      collect(full, name);
    } else {
      entries.push({ name, data: readFileSync(full) });
    }
  }
};
collect(SRC);

const local = [];
const central = [];
let offset = 0;
for (const e of entries) {
  const nameBuf = Buffer.from(e.name, "utf8");
  const raw = e.data || Buffer.alloc(0);
  const crc = crc32(raw);
  let method = 0;
  let body = raw;
  if (raw.length) {
    const deflated = deflateRawSync(raw, { level: 9 });
    if (deflated.length < raw.length) {
      method = 8;
      body = deflated;
    }
  }
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4); // version needed
  lh.writeUInt16LE(0, 6); // flags
  lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(dosTime, 10);
  lh.writeUInt16LE(dosDate, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(body.length, 18);
  lh.writeUInt32LE(raw.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  lh.writeUInt16LE(0, 28);
  local.push(lh, nameBuf, body);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4); // version made by
  ch.writeUInt16LE(20, 6); // version needed
  ch.writeUInt16LE(0, 8);
  ch.writeUInt16LE(method, 10);
  ch.writeUInt16LE(dosTime, 12);
  ch.writeUInt16LE(dosDate, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(body.length, 20);
  ch.writeUInt32LE(raw.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt16LE(0, 30); // extra len
  ch.writeUInt16LE(0, 32); // comment len
  ch.writeUInt16LE(0, 34); // disk
  ch.writeUInt16LE(0, 36); // internal attrs
  ch.writeUInt32LE(0, 38); // external attrs
  ch.writeUInt32LE(offset, 42);
  central.push(ch, nameBuf);

  offset += lh.length + nameBuf.length + body.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

writeFileSync(zipPath, Buffer.concat([...local, centralBuf, end]));

console.log(`\nWrote ${relative(ROOT, zipPath)} — ${entries.length} entries, ${version}`);
for (const e of entries) console.log(`        ${e.name}`);

console.log(`
Next:

  1. Sign the Firefox build (needs ./doxa-amo.env):
       set -a; . ./doxa-amo.env; set +a
       npx web-ext sign --source-dir extension --channel unlisted \\
         --api-key "$AMO_ISSUER" --api-secret "$AMO_SECRET"
     Then rename the signed file:
       mv web-ext-artifacts/comment_summarizer_local-${version}.xpi doxa-${version}-fx.xpi

  2. Sanity-check it before publishing (0 errors expected):
       npx web-ext lint --source-dir extension

  3. Commit the bump and tag the exact commit the zip was built from:
       git add extension/manifest.json && git commit -m "Release ${version}: <what changed>"
       git tag v${version} && git push origin HEAD v${version}

  4. Publish a GitHub Release for tag v${version} with BOTH assets:
       doxa-extension-${version}.zip   doxa-${version}-fx.xpi
     Installed Firefox copies pick it up via the extension's own update banner
     (popup.js/background.js keep that checker in Firefox; it is gated off in the
     Safari build for App Store guideline 2.4.5(vii)).
`);
