# Today's Daf (daf-yomi)

Standalone, public, free Daf Yomi site at **https://daf-yomi.dev**. Independent of the gizmo-warehouse code (a warehouse post may
link here later). Joe's decisions, 2026-09-20: AI-written note, fully transparent; Cloudflare Workers +
cron; permalinks for every daf.

## Non-negotiables

- **Every text comes from Sefaria.** Nothing is typed in, nothing is paraphrased as text. If Sefaria is
  down, the page says so; no fallback text.
- **The note is labelled as AI every time**, above the words, in the RSS feed, and in the API. Never
  soften the label. Never let the note cite Rashi/Tosafot/later authorities, state halacha as practice,
  or quote something not in the daf. `src/note/grounding.ts` enforces this; tests cover it.
- **Attribution on every page**: William Davidson Talmud, Koren Noé, Steinsaltz, Sefaria, CC BY-NC 4.0.
  Non-commercial forever.
- **No em dashes, no AI tells** in any rendered prose (`test/render.test.ts` checks the chrome; the
  grounding check covers notes).
- Joe's voice on `/about`: first person, plain, dry. Not corporate.
- **Share cards never render on a visit.** The per-daf social image (`src/og`) is drawn by the card cron and
  `/admin/og/bake` only; the image route serves KV or falls back to the static card. A page points at a card only
  while the card shows the note on that page (`cardCurrent`), so a stale question is never behind a shared link.
- **Design direction (Joe, 2026-09-20):** warm parchment, brown ink, oxblood and gold; "the office of a great old
  Torah scholar," human and lived in, exciting for a day of Torah. White/clinical surfaces were rejected. Assume
  the reader has never heard of Rabbi Steinsaltz, Sefaria, or a Seder: gloss every such name on first appearance.

## Layout

`src/daf` schedule + tractate table · `src/sefaria` fetch + sanitize · `src/note` prompt, grounding,
generate, KV store · `src/render` HTML (and `email.ts`, the daily issue) · `src/newsletter` readers, the
hourly send tick, opt-in, provider (see NEWSLETTER.md) · `src/og` the per-daf share card (template, KV store, Browser
Rendering, the card bake; see HOSTING.md "Share cards") · `src/index.ts` routes · `src/cron.ts` nightly bake ·
`prompts/daf-note.md` the house style (bump `PROMPT_VERSION` in `src/note/prompt.ts` when it changes
enough to re-bake) · `scripts/` bake table, verify cycle, try notes, backfill, check links ·
`data/tractates.json` generated, commit it.

## Languages

English, Hebrew (`/he`, Pre-Release until `HE_PUBLIC=1`), Yiddish later on the same machinery. Rules:

- Chrome strings live in `src/i18n/` (one table per language, same keys); never a literal in a renderer. Hebrew assumes a
  reader who knows what a Seder and a mishna are: no glossing, no Steinsaltz introduction. `test/i18n.test.ts` guards it.
- The Talmud text is never AI-translated. Hebrew pages show Sefaria's Steinsaltz biur; the original sits behind a toggle.
- Notes are **translated from the approved English note** (`prompts/daf-translate-he.md`, `src/note/translate.ts`), quotes
  swapped for the original words and checked verbatim against the Hebrew/Aramaic. A translation belongs to one English
  bake (`of`); a re-bake retires it. Translations never generate on a visit (the crawler incident): cron for the near
  days, `npm run translate` for the rest. Bump `TRANSLATE_PROMPT_VERSION` when the Hebrew style changes enough to re-do.
- A language stays Pre-Release (noindex, unlisted, a notice on every page) until its native reviewer round is done.
- Time axes (the position bar, the About diagram) stay left-to-right in every language; everything else is RTL via
  logical CSS properties.

## Working here

- `npm test` and `npm run typecheck` before any deploy. `npm run verify:cycle -- --sample 80` after
  touching the schedule or the table.
- Free-plan Workers: 10 ms CPU per invocation. Rendering is cached at the edge; the cron bakes at most
  three dapim per run. If CPU limits ever bite, Workers Paid ($5/mo) is the fix, not a rewrite.
- Push ≠ deploy here either: `npm run deploy` is the deploy. Verify the live URL after.
- KV keys: `ref:v1:<slug>:<daf>`, `note:v1:<slug>:<daf>`, `tnote:v1:<lang>:<slug>:<daf>` (translated notes),
  `og:v1:<slug>:<daf>` (the share card PNG, provenance in its metadata), `ogcursor:v1` (the card trickle's place),
  `gen:<date>` and `confirm:<date>` (daily counters).
  Sefaria text (`text:v2:`) and generation locks live in the edge Cache API, not KV (free plan: 1,000 KV
  writes a day). Readers live in D1 (`NEWSLETTER_DB`), never in KV.
- Newsletter rules: the send path never fetches from Sefaria (a test greps for it); the AI label travels
  into the email verbatim except for its pointer ("of this daf, linked below"); every issue carries
  RFC 8058 one-click unsubscribe headers and a footer link; no images, no tracking, no postal address (Joe's
  call: non-commercial); `NEWSLETTER_PUBLIC` gates the nav tab and the form until launch.
- Style iteration is a review round with Joe: `npm run bake:note -- <targets>` on 5 varied dapim, edit
  `prompts/daf-note.md`, repeat. Re-bake the archive with `npm run backfill -- --force`.
