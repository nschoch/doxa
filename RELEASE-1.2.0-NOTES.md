# Doxa 1.2.0

**New: summarize Lemmy comment threads.** Open a post on any supported instance
and the same one-click summary you already get on Reddit and YouTube now works
there — no API key, no account, nothing to configure.

Lemmy is a federated link aggregator (the Fediverse's Reddit alternative). Doxa
recognizes post pages like `https://lemmy.world/post/11967676`.

## How it reads the thread

Doxa asks the instance's own public API (`/api/v3/comment/list`, sorted by top
score) for the comments, which gives it the original Markdown text and the real
reply structure instead of scraping whatever happens to be rendered. If that
request fails or returns nothing, it falls back to the comments already visible
on the page.

Two details worth knowing:

- **Top-voted first, capped per thread.** The API sorts by score, and each
  top-level thread contributes at most "Max comments per thread" comments — the
  same setting Reddit uses — so one long off-topic reply chain can't crowd out
  the rest of the discussion. "Max reply depth" applies here too.
- **Federated posts may come back empty.** On a post whose thread lives on
  another instance, the local server sometimes hasn't fetched the comments yet.
  Doxa says so plainly ("Lemmy hasn't loaded this thread's N comment(s) from the
  remote instance yet") rather than summarizing nothing and leaving you guessing.

## Supported instances

Ten popular ones work out of the box: lemmy.world, lemmy.ml, beehaw.org,
lemmy.ca, lemm.ee, lemmy.nz, sh.itjustingsocial.net, programming.dev,
mandalore.net, gamingcommunity.net.

For any other instance, open the toolbar button → Settings → Sites → **Add
instance**. Doxa asks your browser to grant access to that single hostname; if
you decline, nothing changes, and you can remove an added instance at any time.

## Privacy

Lemmy requests are anonymous: no account, no token, no credentials read or
stored. Only the post ID of the page you're already viewing goes to the site
whose page you're on. As before, the comment text is sent only to the model
provider *you* configured — local Ollama by default. See PRIVACY.md.

## Also in this release

A latent bug is fixed: Doxa used to fall through to a generic DOM collector on
any unrecognized page, so an unsupported site could produce a summary of
arbitrary page text. Unknown hosts now report no comments instead.

## Testing notes

This build is signed for self-hosted installation. To install: open the `.xpi`
in Firefox and confirm the prompt. Because your existing 1.1.3 has the same add-on
ID, installing 1.2.0 replaces it — export or note your settings first if you
want to compare behaviour across versions.

If you'd rather not touch your installed copy, load it unpacked instead:
`about:debugging` → This Firefox → **Load Temporary Add-on** → pick
`extension/manifest.json` from the zip. Temporary add-ons stop working when
Firefox restarts.

Known untested surface: this is the first release with Lemmy support, so please
report a thread that summarizes badly or an instance where nothing loads.
