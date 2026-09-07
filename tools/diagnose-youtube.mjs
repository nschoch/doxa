// diagnose-youtube.mjs
// Feedback loop for YouTube comment/transcript extraction: fetches a real watch
// page and runs the SAME logic as extension/content.js, then reports a
// red/green signal. Run: node tools/diagnose-youtube.mjs [videoUrl]
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

async function main() {
  const url = process.argv[2] || "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  console.log("=== Fetching", url, "===");
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const html = await res.text();
  console.log("HTTP", res.status, "| HTML bytes:", html.length);

  const data = findPageVar(html, "ytInitialData");
  const play = findPageVar(html, "ytInitialPlayerResponse");

  console.log("\n=== COMMENTS (from ytInitialData) ===");
  if (!data) {
    console.log("  ytInitialData: NOT FOUND / not parseable");
  } else {
    const comments = collectComments(data);
    console.log("  ytInitialData parsed. comment count:", comments.length);
    if (comments.length) {
      comments.slice(0, 3).forEach((c, i) =>
        console.log(`  [${i + 1}] ${c.slice(0, 160)}`),
      );
    } else {
      console.log("  No commentRenderer.contentText found in ytInitialData.");
    }
  }

  console.log("\n=== TRANSCRIPT (from ytInitialPlayerResponse) ===");
  if (!play) {
    console.log("  ytInitialPlayerResponse: NOT FOUND / not parseable");
  } else {
    const tracks = captionTracks(play);
    console.log("  caption tracks:", tracks.length);
    if (tracks.length) {
      console.log("  first track lang:", tracks[0].languageCode, "| baseUrl:", tracks[0].baseUrl.slice(0, 80) + "...");
      const t = await tryTranscript(tracks[0]);
      console.log("  transcript fetch:", t.ok ? `OK, ${t.text.length} chars` : `FAILED (${t.err})`);
      if (t.ok) console.log("  first 200 chars:", t.text.slice(0, 200));
    }
  }
}
main().catch((e) => {
  console.error("harness error:", e && e.message ? e.message : e);
  process.exit(1);
});

function findPageVar(html, name) {
  for (const pat of [`${name} =`, `var ${name} =`, `window.${name} =`]) {
    const idx = html.indexOf(pat);
    if (idx === -1) continue;
    const start = html.indexOf("{", idx);
    if (start === -1) continue;
    let depth = 0,
      inStr = false,
      esc = false,
      i = start;
    for (; i < html.length; i++) {
      const ch = html[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    try {
      return JSON.parse(html.slice(start, i));
    } catch (_) {}
  }
  return null;
}

function runsToText(ct) {
  if (!ct) return "";
  if (typeof ct === "string") return ct;
  if (ct.simpleText) return ct.simpleText;
  if (Array.isArray(ct.runs)) return ct.runs.map((r) => (r && r.text) || "").join("");
  return "";
}

function collectComments(data) {
  const out = [];
  const stack = [data];
  const seen = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== "object") continue;
    if (seen.has(n)) continue;
    seen.add(n);
    if (Array.isArray(n)) {
      for (const x of n) stack.push(x);
      continue;
    }
    if (n.commentRenderer && n.commentRenderer.contentText) {
      const t = runsToText(n.commentRenderer.contentText).trim();
      if (t) out.push(t);
    }
    for (const k of Object.keys(n)) stack.push(n[k]);
  }
  return out;
}

function captionTracks(play) {
  try {
    return (
      play.captions.playerCaptionsTracklistRenderer.captionTracks || []
    );
  } catch (_) {
    return [];
  }
}

async function tryTranscript(track) {
  try {
    const baseUrl = track.baseUrl || "";
    const url = baseUrl + (baseUrl.includes("fmt=") ? "" : "&fmt=json3");
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return { ok: false, err: `HTTP ${r.status}` };
    const txt = await r.text();
    let text = "";
    try {
      const j = JSON.parse(txt);
      for (const ev of j.events || [])
        for (const s of ev.segs || []) if (s.utf8) text += s.utf8;
    } catch (_) {
      text = txt.slice(0, 200);
    }
    return { ok: text.length > 0, text };
  } catch (e) {
    return { ok: false, err: e && e.message ? e.message : String(e) };
  }
}
