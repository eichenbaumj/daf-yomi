# Handover: two growth builds for daf-yomi.dev

Written 2026-09-21 at the end of a long session with Joe. Read this whole file, then `CLAUDE.md`,
`NEWSLETTER.md` and `HOSTING.md`, before touching code. Plan mode first: both builds are multi-file.

## Where things stand

- Site live since 2026-09-20 at https://daf-yomi.dev (Cloudflare Worker, `src/`). Newsletter public since
  2026-09-21 (3 active subscribers). Hebrew mode is Pre-Release at `/he` (`HE_PUBLIC=0`), not indexed.
- Launch day: ~300 Cloudflare "visits", mostly from Joe's wife's Bronfman Center listserv post, inflated by
  scanners (Cisco Umbrella misclassified the domain as malware that morning) and by email-link clicks.
- Today's session shipped: My Jewish Learning in "Go deeper" (per-daf link, verified slugs in
  `data/tractates.json`), the Hadran link (had never rendered: `hadranSlug` was never populated),
  and a folded one-line sign-up under the AI note (`renderInlineSubscribe`, `<details>`).
- Joe's framing of the product (memory `project_daf_note_purpose`): the notes exist to start HUMAN
  conversations about Talmud. Replies go to Joe, not Claude. The question field is the product.
  Grow alongside Sefaria, never against it. Site voice: first-person Joe, dry, plain, no em dashes.
- The big date: cycle 14 ends 7 June 2027; cycle 15 opens with Berakhot 2 on 8 June 2027. Joe wants a
  major release for that day. Both builds below should be designed as things that are mature by then.

## Build 1: make the link itself do the selling

**Shipped 2026-09-22** (commits `1ff8535` to `2d44670`, then the same-day revision; operator notes in `HOSTING.md`,
"Share cards"). What differed from the brief below: PNGs are drawn by Cloudflare Browser Rendering from the Worker
(on the free plan; 10 browser-minutes a day), on a fourth cron 20 minutes after each note bake, not in the bake
itself and not with Pillow; the image URL's token changes on every redraw, not only on a new note; a design-stale
card keeps serving until redrawn (only a changed note retires a card). **Joe's review the same day changed the
product:** the card shows the note (the summary), not the question ("the questions require you to read the note
first; the notes are beautiful and best first"), and "Share this note" copies only the permalink, never words,
so a text thread shows the card. Same day, after the iMessage test: the pill became the right-hand "pillar" of a
quiet line inside the note (sign-up on the left, share on the right; mock-ups chosen by Joe), and the position bar
opens on the six Orders (one fewer zoom step). The daily email is unchanged.

**Why.** Daf yomi spreads through group chats and forwarded emails, not search. Today every shared link
shows the same static `public/og.png`. A forwarded link should carry that day's question.

**End state.**
1. Per-daf social image, 1200x630, parchment palette, carrying: tractate + daf, the date, the AI note's
   QUESTION (large, the hero), a small "Today's Daf" wordmark and the AI label. No summary text (too long
   for a card). Fallback to the current static card when no note exists for that daf.
2. `og:image` / `twitter:image` on every daf page point at the per-daf image; the homepage (today) too.
   `twitter:card` = `summary_large_image`.
3. A "Share this question" control on the daf page, next to or inside the note box, that copies
   `"<question>" — <label>, <url>` to the clipboard (Web Share API on mobile where available). Quiet
   styling, same register as the toggles. No tracking of shares (the privacy page promises none).
4. The daily email's preview text / hero stays as is; if the email gains an image, it is the same card.

**How, and gotchas.**
- Rendering: Workers cannot run Pillow. Options, in order of preference: (a) render SVG server-side in
  the Worker (pure string work, cheap, fonts embedded as base64 subsets or referenced via CSS in the SVG),
  served at `/og/<slug>/<daf>.svg` or `.png` via an image-conversion path; (b) generate PNGs at bake time
  with `scripts/og-card.py` (Pillow, fonts cached in `scripts/.fonts-cache`) and upload to KV or R2.
  Check first which crawlers accept SVG for og:image (most do not: Facebook, iMessage, WhatsApp, Slack
  want PNG/JPEG). That constraint probably decides it: PNG. If Workers-side PNG is wanted, look at
  `@cloudflare/pages-plugin-vercel-og`/`workers-og` (Satori + resvg-wasm) and check bundle size against
  the free plan's 3 MB compressed limit and 10 ms CPU. Otherwise bake PNGs in the 06:00 UTC cron after
  `ensureNote` (see `src/cron.ts`) and store in KV `DAF_KV` (binding exists) or add an R2 bucket.
- The note is written nightly for D+1 (bake at 06:00 UTC, `ensureNote(D+1), ensureNote(D), ensureNote(D+2)`),
  so the card for tomorrow can exist before midnight anywhere. A card must never carry a stale question:
  key it by note `generatedAt` or `promptVersion` hash, and regenerate when `rebuild-edition`/note
  regeneration happens.
- Hebrew: the `/he` pages would want a Hebrew card with the translated question. Pillow has no raqm
  here; `og-card.py` reverses Hebrew by hand. Ship English first; leave a clean seam for Hebrew.
- Text fitting: questions run 15 to 40 words. Fit by shrinking font in steps; never truncate a question.
- Fonts: Source Serif 4 for the question (it is the site's voice), Frank Ruhl Libre for Hebrew.
- Edge cache: page HTML is cached with the build id in the key (`ck()` in `src/index.ts`); the image
  URL should carry a version component so a regenerated card is never served stale by crawlers'
  caches either (Facebook caches og:image aggressively; a changed URL is the only reliable bust).
- Tests: `test/render.test.ts` covers the daf page head; add assertions for the per-daf og:image URL,
  the fallback, and the share control's markup. Vitest, `npm test`, `npm run typecheck`.
- Deploy ONLY with `npm run deploy` (stamps `BUILD` into the cache key). Raw `wrangler deploy` serves
  stale HTML for up to 10 minutes. Verify on the live URL with `?nocache=1`, then the cached URL.
- Verify the cards where they will actually be seen: paste a permalink into iMessage/WhatsApp/Slack
  or use opengraph.xyz and Facebook's sharing debugger. "Done" = the question visible in a real preview.

## Build 2: Search (CUT by Joe, 2026-09-22: do not build)

Joe, on reviewing Build 1: skip all search improvements; the habit is the product. We are not yet a full studying
app; it is all about brevity: a 40-second solution to study, a complementary good to the amazing 1-to-2-hour
products (Sefaria and the rest). The Tractates section already provides the completeness we need while staying
correctly in the background. No `/search`, no index, no `SEARCH.md`. The notes below are kept only as a record of
what was considered; ask Joe before reopening any of it.

**Joe's words.** A "Search" button right after "Tractates" in the top nav. Click it and you land on
"the best, most searchable repo of AI-enabled daf yomi-ing / the whole Babylonian Talmud in the entire
ecosystem." He wants this built slowly and well: consider it for a month, and treat "Search 2.0" as a
candidate feature for the 8 June 2027 release. This session does the FIRST upgrade: a real, honest,
fast search that is clearly better than nothing and clearly a v1.

**What exists to search.**
- Every AI note ever written: KV `note:v1:*` (`src/note/store.ts`), with summary, question, quotes,
  model, promptVersion, generatedAt. Growing by one a day; ~2,711 by cycle end. Small: fits in one JSON.
- Every translated note (`src/note/tstore.ts`).
- The English text of every daf, via Sefaria (`src/sefaria/client.ts`), cached in KV as pages are
  baked. The full Bavli in English is tens of MB; it does not fit a Worker request, and Sefaria already
  has full-text search. Do not rebuild Sefaria's search. Do link to it for text hits.
- Tractate metadata and chapter titles (`data/tractates.json`, `src/daf/position.ts`).

**Suggested v1 shape (validate in plan mode; Joe will have opinions).**
1. Route `GET /search` (+ `/he/search` later) and `navSearch` string in `src/i18n/en.ts`/`he.ts`,
   nav link after Tractates in `src/render/layout.ts`.
2. One search box. Results in three groups: (a) Notes: full-text over all AI notes' summary +
   question + quotes, ranked, showing the question as the headline and the daf as the link; (b) Places:
   tractate names, chapter titles, "Bekhorot 3", "Kodashim", dates ("yesterday", "2026-09-20"); (c) The
   text: a single "Search the Talmud itself on Sefaria for '…'" link (Sefaria's search URL), until we have
   our own text index.
3. Index: build a compact JSON index of all notes at bake time (after `ensureNote`) into KV under one
   key; the search route loads it and searches in the Worker (a few hundred KB is fine under 10 ms CPU
   for simple scoring; measure). Client-side search over the same JSON is the alternative that removes
   Worker CPU from the picture and makes typing instant; consider shipping both: server-rendered
   results for no-JS and crawlers, progressive enhancement for instant results.
4. Hebrew/Aramaic: normalize nikkud and final letters; allow transliteration variants for sage names
   (Rav Nahman / Nachman / Naḥman). The grounding gate's `normalize()` in `src/note/grounding.ts` is a
   start.
5. Every result must be honest about what it is: "AI note" label, date written, prompt version. A
   search over AI-written text must not be mistaken for a search over the Talmud.
6. Empty state and zero-results copy in Joe's voice. Search pages `noindex` for now.

**Search 2.0 ideas to note in the plan, not build now:** our own full-text index of the English text
(Cloudflare Vectorize or D1 FTS5; D1 binding already exists), semantic search over notes with embeddings
("where does the Talmud argue about partial ownership?"), a per-tractate search scope, and a "questions
like this one" link on each daf page. Write these into `SEARCH.md` as a roadmap so the month of
thinking has a place to land.

**Gotchas.**
- Free plan limits (see `NEWSLETTER.md`, "Limits that shape the code"): 10 ms CPU per request, 50
  subrequests, KV 1,000 writes/day (index rebuild is one write). Measure CPU on the search route with a
  realistic index before shipping; if it is tight, go client-side.
- `Vary`: nothing may vary a cached body. Search results with a query string: set `cache-control:
  no-store` or key on the query; check `src/cache.ts`.
- The Hebrew nav is a separate string set (`src/i18n/he.ts`); tests in `test/i18n.test.ts` check parity.
- No tracking of queries. The privacy page promises no logs beyond what it lists; keep it true. If
  you want to know what people search, ask Joe first; the answer may be a daily aggregate count only.

## Order of work

Build 1 first (a week of compounding value for every shared link, and it is mostly render work).
Then Build 2 in plan mode with Joe. Update `NEWSLETTER.md`/`README.md`/`CLAUDE.md` in the same session
as each change. Commit with the Co-Authored-By line from the session reminder. Push freely; deploy with
`npm run deploy`; verify live.

## Not in scope here (Joe is doing these himself)

Kind outreach notes to Hadran, My Jewish Learning, Kollel Iyun Hadaf, Steinsaltz Center, Sefaria and
Hebcal asking for a resource-list link; press through his own connections; reading r/Judaism and
r/Talmud to learn the dynamics; planning the 8 June 2027 release. If he asks for drafts of the notes,
they are short, first-person, say what the site links to of theirs and what it does differently,
and ask for nothing more than a listing.
