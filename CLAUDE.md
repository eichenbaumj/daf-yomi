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
- **Curly apostrophes and quotes in the site's own prose** (Joe, 2026-09-22): `src/render/typography.ts` makes them at
  render time (page wrapper, email, feed, card). Notes stay straight in KV and the API. Sefaria's text is fenced
  (`SEFARIA_OPEN`/`SEFARIA_CLOSE`) and never touched; Hebrew chrome is left alone.
- **No em dashes, no AI tells** in any rendered prose (`test/render.test.ts` checks the chrome; the
  grounding check covers notes).
- Joe's voice on `/about`: first person, plain, dry. Not corporate.
- **The map of the page is AI and says so.** `src/map` draws the daf into its moves (twelve fixed kinds, each unit a
  range of segments, one shape sentence) and the page labels it AI above its words, on the page and in the API. A unit
  must begin wherever the text's own marks (§, MISHNA:, GEMARA:, the Yerushalmi labels) begin one, kinds come from
  `MAP_KINDS` only, and every string obeys the note's rules (`src/map/gate.ts` reuses `grounding.ts`). Never drawn on a
  visit: the cron draws the near days, `scripts/maps-backfill.ts` the rest. Joe froze the words on 2026-09-22 (heading
  "The shape of the page", the label sentence, the kinds); the block has its own toggle, open by default.
- **Share cards never render on a visit.** The per-daf social image (`src/og`) is drawn by the card cron and
  `/admin/og/bake` only; the image route serves KV or falls back to the static card. A page points at a card only
  while the card shows the note on that page (`cardCurrent`), so a stale question is never behind a shared link.
- **Design direction (Joe, 2026-09-20):** warm parchment, brown ink, oxblood and gold; "the office of a great old
  Torah scholar," human and lived in, exciting for a day of Torah. White/clinical surfaces were rejected. Assume
  the reader has never heard of Rabbi Steinsaltz, Sefaria, or a Seder: gloss every such name on first appearance.

- **The house style is Joe's and is frozen** (2026-09-22): "needles the text", "curiosity over reverence", the Hillel
  exemplar stay. Two things were added that day and nothing else: the strongest-answer protocol (find the page's own
  answer before calling a question open) and the reach of the question (the idea under the case, not the mechanics).
  Changes to the judge's rebake criteria (`verifyJudgment` in `src/note/judge.ts`) go through Joe.

## Layout

`src/daf` schedule + tractate table · `src/sefaria` fetch + sanitize · `src/note` prompt, grounding,
generate, KV store, `screen.ts` (lexical triage, never a gate), `judge.ts` (the second reading; `prompts/daf-judge.md`,
`JUDGE_PROMPT_VERSION`) · `src/render` HTML (and `email.ts`, the daily issue) · `src/newsletter` readers, the
hourly send tick, opt-in, provider (see NEWSLETTER.md) · `src/og` the per-daf share card (template, KV store, Browser
Rendering, the card bake; see HOSTING.md "Share cards") · `src/index.ts` routes · `src/cron.ts` nightly bake ·
`prompts/daf-note.md` the house style (bump `PROMPT_VERSION` in `src/note/prompt.ts` when it changes
enough to re-bake) · `src/map` the map of the page (`kinds.ts` the vocabulary, `cues.ts` the numbered page and its marks,
`prompt.ts` + `prompts/daf-map.md` + `MAP_PROMPT_VERSION`, `gate.ts`, `generate.ts` (`ensureMap`, three drafts, no lock),
`store.ts`, `judge.ts` + `prompts/daf-map-judge.md` the second reading, offline only) and `src/render/pageMap.ts` (the block,
the markers, the running head) · `scripts/` also `bake:map`, `maps:backfill` (the archive, Batch API), `maps:audit` (the
judge over stored maps, `data/audit/maps-<date>.json`) · `scripts/` bake table, verify cycle, try notes, backfill, check links, and the audit trio
(`notes:export`, `notes:audit`, `notes:rebake`; shared bits in `scripts/lib/`) · `data/tractates.json` generated,
commit it · `data/audit/<date>.json` the judge's verdict on every note, committed, with `<date>.outcomes.json` after a
re-bake.

## Languages

English, Hebrew (`/he`, Pre-Release until `HE_PUBLIC=1`), Yiddish later on the same machinery. Rules:

- Chrome strings live in `src/i18n/` (one table per language, same keys); never a literal in a renderer. Hebrew assumes a
  reader who knows what a Seder and a mishna are: no glossing, no Steinsaltz introduction. `test/i18n.test.ts` guards it.
- The Talmud text is never AI-translated. Hebrew pages show Sefaria's Steinsaltz biur; the original sits behind a toggle.
- Notes are **translated from the approved English note** (`prompts/daf-translate-he.md`, `src/note/translate.ts`), quotes
  swapped for the original words and checked verbatim against the Hebrew/Aramaic. A translation belongs to one English
  bake (`of`); a re-bake retires it. Translations never generate on a visit (the crawler incident): cron for the near
  days, `npm run translate` for the rest. Bump `TRANSLATE_PROMPT_VERSION` when the Hebrew style changes enough to re-do.
- The Hebrew note gets a second reading: the Hebrew judge (`src/note/tjudge.ts`, `prompts/daf-judge-he.md`) reads the
  translation beside the English on the cron, `/admin/translate` and `npm run translate`, once per bake and never on a
  rewritten draft; the verdict is derived in code from verified spans. `npm run translate:try -- <targets> --judge` for
  review rounds, `npm run notes:audit:he` over the archive. Bump `TRANSLATE_JUDGE_PROMPT_VERSION` when its criteria change.
- A language stays Pre-Release (noindex, unlisted, a notice on every page) until its native reviewer round is done.
- Time axes (the position bar, the About diagram) stay left-to-right in every language; everything else is RTL via
  logical CSS properties.

## Working here

- `npm test` and `npm run typecheck` before any deploy. `npm run verify:cycle -- --sample 80` after
  touching the schedule or the table.
- Workers Paid since 2026-09-22 (KV writes billed per million, no daily ceiling; CPU 30 s and more). The design still
  treats KV writes as precious and the Cache API as the place for anything cache-like. Rendering is cached at the edge;
  the cron bakes at most three notes, three maps and three translations per run (`DAILY_GENERATION_CAP` 18).
- After `npm run deploy`, wait about 20 seconds before calling an `/admin/*` endpoint: the first call after a deploy
  landed on the previous version twice on 2026-09-22.
- Push ≠ deploy here either: `npm run deploy` is the deploy. Verify the live URL after.
- KV keys: `ref:v1:<slug>:<daf>`, `note:v1:<slug>:<daf>`, `tnote:v1:<lang>:<slug>:<daf>` (translated notes),
  `map:v1:<slug>:<daf>` (the map of the page; `tmap:v1:<lang>:<slug>:<daf>` when the Hebrew map lands),
  `og:v1:<slug>:<daf>` (the share card PNG, provenance in its metadata), `ogcursor:v1` (the card trickle's place),
  `gen:<date>` and `confirm:<date>` (daily counters).
  Sefaria text (`text:v2:`) and generation locks live in the edge Cache API, not KV (free plan: 1,000 KV
  writes a day). Readers live in D1 (`NEWSLETTER_DB`), never in KV.
- Newsletter rules: the send path never fetches from Sefaria (a test greps for it); the AI label travels
  into the email verbatim except for its pointer ("of this daf, linked below"); every issue carries
  RFC 8058 one-click unsubscribe headers and a footer link; no images, no tracking, no postal address (Joe's
  call: non-commercial); `NEWSLETTER_PUBLIC` gates the nav tab and the form until launch.
- Style iteration is a review round with Joe: `npm run bake:note -- <targets>` on 5 varied dapim, edit
  `prompts/daf-note.md`, repeat. The archive is re-baked precisely, not wholesale: `npm run notes:export`, then
  `npm run notes:audit -- --all --review` (the judge, one Message Batch), read the spread with Joe, then
  `npm run notes:rebake -- --audit data/audit/<date>.json` over as many days as the KV budget needs, then the
  `translate` and `og:backfill` commands it prints. HOSTING.md "Note quality audits" has the procedure and costs.
- The map's style iterates the same way: `npm run bake:map -- <targets>` (stdout only, `--json` for a review file) on
  varied dapim (a `§`-marked page, a glued MISHNA, a page with no marks, a Yerushalmi day, a 70-segment page), edit
  `prompts/daf-map.md`, repeat; bump `MAP_PROMPT_VERSION` when the archive should be re-drawn.
- The cron and `/admin/bake` run the judge once per draft (`judge: "once"` in `ensureNote`); a note the judge sends
  back gets one more draft with its feedback, never a second judge. Offline notes arrive through `POST /admin/note/put`,
  which re-runs the gate, refuses a stale style, and refuses unless `replaces` is the stored note's `generatedAt`.
- Hebrew follows English: never backfill the Hebrew archive while an English re-bake is pending, or it inherits the
  flaws and is retired the moment the English note changes.
