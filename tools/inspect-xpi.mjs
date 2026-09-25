// Inspect a signed Firefox .xpi (or the release .zip) without needing `unzip`.
//
// Used to verify a release artifact *before* it is attached to a GitHub Release:
// confirm the version, the extension id, that the AMO signature is present, and
// that the files inside match this working tree. Reading the zip by hand keeps
// this working in environments that lack `unzip`.
//
// Usage (from the repo root):
//   node tools/inspect-xpi.mjs web-ext-artifacts/<name>.xpi
//   node tools/inspect-xpi.mjs doxa-extension-1.1.2.zip --compare   # diff vs extension/
//
// Exit 0 = readable and (with --compare) every file matches the tree.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { inflateRawSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");

const args = process.argv.slice(2);
const compare = args.includes("--compare");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: node tools/inspect-xpi.mjs <artifact.xpi|zip> [--compare]");
  process.exit(2);
}
const path = resolve(ROOT, file);
if (!existsSync(path)) {
  console.error(`no such file: ${path}`);
  process.exit(2);
}

// --- minimal zip reader (central directory → local entries) ---
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end-of-central-directory record)");
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt central directory");
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeader = buf.readUInt32LE(p + 42);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localHeader + 26);
    const lExtraLen = buf.readUInt16LE(localHeader + 28);
    const start = localHeader + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    out.set(name, { data, method, crc, uncompressedSize });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const entries = readZip(readFileSync(path));
const names = [...entries.keys()].sort();

console.log(`\n${file}`);
console.log(`  entries: ${names.length}`);

const manifestEntry = entries.get("manifest.json");
if (!manifestEntry) {
  console.error("  FAIL: no manifest.json at the archive root");
  process.exit(1);
}
const manifest = JSON.parse(manifestEntry.data.toString("utf8"));
const geckoId =
  manifest.browser_specific_settings && manifest.browser_specific_settings.gecko
    ? manifest.browser_specific_settings.gecko.id
    : "(none)";
console.log(`  version: ${manifest.version}`);
console.log(`  name:    ${manifest.name}`);
console.log(`  gecko id:${geckoId}`);

// AMO signs into META-INF/ (mozilla.rsa + mozilla.sf + manifest.mf).
const meta = names.filter((n) => n.startsWith("META-INF/"));
if (meta.length) {
  console.log(`  signature: present — ${meta.join(", ")}`);
} else {
  console.log("  signature: NONE (unsigned build — fine for the .zip, not for the .xpi)");
}
console.log("  files:");
for (const n of names) {
  const e = entries.get(n);
  const kb = (e.uncompressedSize / 1024).toFixed(1).padStart(7);
  console.log(`    ${kb} KB  ${n}`);
}

// --- optional: does the payload match this working tree? ---
if (compare) {
  const SRC = resolve(ROOT, "extension");
  let bad = 0;
  let checked = 0;
  for (const n of names) {
    if (n.endsWith("/") || n.startsWith("META-INF/")) continue;
    const src = join(SRC, n);
    if (!existsSync(src)) {
      console.log(`  DIFF: ${n} is in the archive but not in extension/`);
      bad++;
      continue;
    }
    checked++;
    const a = readFileSync(src);
    const b = entries.get(n).data;
    if (a.compare(b) === 0) continue;
    // AMO re-serialises manifest.json when it signs, so the bytes differ by
    // whitespace (it drops the trailing newline) while the document is equal.
    // Compare semantically for that one file rather than failing on formatting.
    if (n === "manifest.json") {
      try {
        if (JSON.stringify(JSON.parse(a.toString("utf8"))) === JSON.stringify(JSON.parse(b.toString("utf8")))) {
          console.log("  note: manifest.json differs only in formatting (AMO re-serialised it)");
          continue;
        }
      } catch {
        /* fall through to the failure below */
      }
    }
    console.log(`  DIFF: ${n} differs from extension/${n}`);
    bad++;
  }
  console.log(
    bad
      ? `\n  FAIL — ${bad} of ${checked} checked files differ from extension/`
      : `\n  OK — all ${checked} archived files match extension/`,
  );
  process.exit(bad ? 1 : 0);
}
