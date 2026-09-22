# Hosting

**Domain: https://daf-yomi.dev** (bought 2026-09-20 via Cloudflare Registrar on this account). `www.daf-yomi.dev` and the original `daf-yomi.joe-2a0.workers.dev` stay attached and 301 to the apex (`CANONICAL_HOST` var; localhost exempt), so links shared before the domain keep working.

Cloudflare Worker `daf-yomi` on Joe's account (joe@group17a.com, account id in wrangler's `whoami`).
Wrangler config: `wrangler.jsonc`. KV namespace `DAF_KV` (id in the config).

## Deploy

```bash
npm test && npm run typecheck
npm run deploy                     # wrangler deploy → https://daf-yomi.dev (and the redirecting hosts)
```

Secrets, set once (they persist across deploys):

```bash
npx wrangler secret put ANTHROPIC_API_KEY   # enables the AI note (cron + self-heal)
npx wrangler secret put ADMIN_TOKEN         # protects POST /admin/bake (any long random string)
```

Without `ANTHROPIC_API_KEY` the site works and the note box says notes are off.

## After a deploy

- Open the live `/`, a permalink, `/feed.xml`, `/api/today.json`. Check `x-daf-cache` flips miss → hit.
- `npm run tail` and hit a page: no errors, CPU time well under 10 ms.
- Backfill so "yesterday" has a note: `npm run backfill -- --site https://daf-yomi.dev --from <2 weeks ago> --to <today>` (reads ADMIN_TOKEN from .dev.vars).
- Cron: `wrangler triggers` are in the config (06:00 and 18:00 UTC). Check the Workers dashboard →
  Triggers → Cron events after the first night.

## Analytics (where the numbers live)

**Cloudflare Web Analytics** for `daf-yomi.dev`, enabled 2026-09-21 with **Automatic setup** (site tag
`9d7ec4faabf643559ab764ae86087a7d`). Dashboard: account → Analytics → Web analytics → daf-yomi.dev, or
`https://dash.cloudflare.com/2a01eeec070de6ec176aaba37d4010fd/web-analytics/overview?siteTag~in=9d7ec4faabf643559ab764ae86087a7d&excludeBots=Yes`.
Page views, visits, top URLs, referrers, countries, browsers, Core Web Vitals; free, cookie-free; the default
view filters bots out (`Exclude bots = Yes`). Within two minutes of creation it showed the previous 24 hours
(238 views / 165 visits), so for a proxied zone the page-view counts come from Cloudflare's edge, not the
beacon; the beacon adds the browser-side measurements (this is inferred from that observation, not from docs).
Data retention is not stated in the docs I checked.

- Cloudflare injects the RUM beacon into Worker-served HTML at the edge. **Do not add the JS snippet to
  `src/render/layout.ts`**: automatic setup is on, and a second copy would load the beacon twice.
- Injection only happens when the request sends `Accept: text/html`. Plain `curl` shows no beacon; check with
  `curl -sH "Accept: text/html" https://daf-yomi.dev/ | grep -c cloudflareinsights` (expect 1). Verified in a
  real browser 2026-09-21: script present in the DOM and `POST /cdn-cgi/rum` → 204.

Other surfaces, all already on:

- **Worker metrics**: Workers & Pages → daf-yomi. Requests, errors, subrequests, CPU and wall time, invocation
  statuses; three months back. Counts every invocation, so crawlers and the cron are in it (the 2026-09-20 crawl
  is a spike here).
- **Workers Logs**: same Worker → Observability tab (`observability.enabled` in `wrangler.jsonc`). Per-request
  method + URL, console output, errors. Free plan: 3 days, 200,000 events a day.
- **Zone HTTP traffic**: daf-yomi.dev → Analytics & Logs → HTTP Traffic. Requests, bandwidth, unique visitors
  (unique IPs), country. Free plan includes bots and crawlers; path and status breakdowns need Pro.
- **API spend**: Anthropic Console → Usage / Cost. Code side: the `gen:<date>` KV counter, capped at 12 a day
  (absent = no cron or self-heal generation that UTC day; forced admin bakes do not count). Read it with
  `npx wrangler kv key get --remote --namespace-id 34d5b074f78b4c5da60c9fcf989315c7 gen:YYYY-MM-DD`.
  **Wrangler's `kv key get/list` default to the local dev store**: without `--remote` every production key is
  "not found" and the listing shows a handful of stale `wrangler dev` keys. Same for counting notes
  (`kv key list --remote --prefix note:v1:`; 2,711 on 2026-09-21).

## Custom domain

`wrangler.jsonc` carries `routes` for `daf-yomi.dev` and `www.daf-yomi.dev` as custom domains; Cloudflare
created the DNS records and the certificate on the first deploy (live within a minute). Workers custom
domains are proxied by design, unlike the Lovable gray-cloud rule for the warehouse. Gotcha: adding
`routes` makes wrangler disable the `*.workers.dev` URL unless `"workers_dev": true` is set explicitly;
we keep it on so the old URL redirects instead of dying. Pages derive absolute URLs from the request
origin, so nothing else needed changing.

## Newsletter (added 2026-09-20)

- D1 database `daf-yomi-newsletter` (id in `wrangler.jsonc`). Create once with `npx wrangler d1 create`,
  then `npm run d1:migrate` after any new file in `migrations/`.
- Secrets: `RESEND_API_KEY` (Resend, sending only), `TOKEN_HMAC_SECRET` (32 random bytes hex), and for the
  public form `TURNSTILE_SECRET_KEY`, `RESEND_WEBHOOK_SECRET` (all four set 2026-09-21; the form opened that night). Vars in `wrangler.jsonc`: `NEWSLETTER_FROM`,
  `NEWSLETTER_REPLY_TO`, `CATCHUP_HOURS`, `EMAIL_HEBREW`, `NEWSLETTER_PUBLIC`, `TURNSTILE_SITE_KEY`.
- DNS for sending, as configured 2026-09-20 (all DNS-only, not proxied): sending domain `news.daf-yomi.dev`
  on Resend with TXT `resend._domainkey.news` (DKIM), CNAME `send.news` → `send.forge.rmta.net` and CNAME
  `rsend.news` → `rsend.forge.rmta.net` (Resend's CNAME-based SPF/return-path), TXT `_dmarc.news`
  `v=DMARC1; p=none; rua=mailto:dmarc@daf-yomi.dev`; on the apex TXT `_dmarc` `v=DMARC1; p=quarantine;
  rua=mailto:dmarc@daf-yomi.dev` (tighten to `p=reject` once the alert sender is set up and reports are clean).
  Email Routing (free) is enabled on the apex (Cloudflare's MX, SPF and DKIM records) with rules
  `daf@daf-yomi.dev` (the Reply-To) and `dmarc@daf-yomi.dev` forwarding to Joe; the destination address needs
  the one-time verification click. Resend's records live on subdomains and do not collide with these.
- The third cron (`0 * * * *`) is the send tick; 3 of the account's 5 free cron slots are now used.
- Limits the tick lives inside: D1 free 50 queries per invocation (a tick uses about a dozen), 50 external
  subrequests (one per batch of 50 readers), 10 ms CPU. Operator notes in NEWSLETTER.md.

## Languages (Hebrew added 2026-09-21, Pre-Release)

- **Paths.** English has no prefix. Hebrew lives under `/he` (`/he`, `/he/bekhorot/2`, `/he/tractates`, `/he/about`,
  `/he/feed.xml`, `/he/yesterday`, `/he/date/…`). Only page routes take a prefix; api, admin, newsletter, robots and the
  sitemap are English-only (`/he/newsletter` 302s to `/newsletter`). `src/router.ts` strips the prefix and re-parses.
- **The switch.** `GET /lang/he?to=/bekhorot/2` sets the `daf_lang` cookie (a year, HttpOnly, SameSite=Lax) and 302s to the
  rebuilt Hebrew path; `to` is parsed with the router and never echoed. Only `/` reads the cookie (302 to `/he`); every
  other path says its language in the URL. `/lang/en` clears it. `Disallow: /lang/` in robots.
- **Cache keys** carry the language (`/_c/<build>/he<path>`); there is still no Vary header anywhere.
- **Text layer.** Hebrew pages show Rabbi Steinsaltz's Hebrew biur (`Steinsaltz on <Tractate>` on Sefaria, CC BY-NC,
  one segment per segment of the daf) as the text, with the vocalized Aramaic behind the "show the original" toggle.
  Kinnim and Middot have no biur; the Mishnah is shown alone. `fetchBiur` in `src/sefaria/client.ts`, edge-cached 30 days.
- **Translated notes** are stored at `tnote:v1:<lang>:<slug>:<daf>` (one KV write each), bound to the English note by
  `of` = its `generatedAt`, and shown only while they match and the translation style (`TRANSLATE_PROMPT_VERSION` in
  `src/note/translate.ts`) is current. They **never self-heal on a visit**: the 06:00/18:00 cron translates the three near
  days (`MAX_TRANSLATIONS_PER_RUN`, counted against `DAILY_GENERATION_CAP`); everything else is `npm run translate`.
- **`npm run translate -- --lang he --window 7 [--dapim slug/daf,…] [--all] [--mode batch|worker] [--force]`.** Batch
  mode (default) needs `ANTHROPIC_API_KEY` locally, runs one Message Batch (half price), checks every result with the
  same `checkTranslation` the Worker uses, and stores via `POST /admin/translate/put` (which checks again and refuses a
  translation of a stale note). Worker mode is one `POST /admin/translate` per daf. Cost anchor: about 13 cents list per
  note at Opus 5, half that in a batch; the archive is 2,711 KV writes (free plan: 1,000 a day, or Workers Paid).
- **The Hebrew judge** (`src/note/tjudge.ts`, `prompts/daf-judge-he.md`; added 2026-09-22 after a native reader scored
  Bekhorot 4 at 60/100: "bad Hebrew", English syntax showing through). The regex gate checks quotes, lengths and banned
  words; the judge reads the Hebrew beside the English and answers three things: does it say what the English says (each
  mismatch as an exact span of both), is the question the same question, and would an Israeli learner write it (each
  stumble as an exact span, its kind and a better wording), plus a naturalness score of 1 to 5. As with the English judge
  the verdict is derived in code (`verifyTranslationJudgment`): a span that is not really in the translation is
  discounted, so a misquoting judge never re-translates anything. Re-translate iff a verified fidelity problem, a
  different question, or `LANGUAGE_REBAKE_THRESHOLD` (2, a first guess; tune it after the first audit) or more verified
  language problems. Where it runs: the cron's translation pass and `POST /admin/translate` pass `judge: "once"`, one
  judge call after a draft passes the gate; a `rebake` verdict buys one more draft with the judge's feedback, stored if
  it passes the gate and never judged again; at most three drafts and one judge per bake, about a cent a call (the pair
  of notes, no page text). `judge=off` on the admin URL skips it. The stored translation carries `review` (naturalness,
  verdict, reasons, and `rewritten` when a later draft is what was stored). `npm run translate` batch mode does the same
  through the Batch API (a draft batch, the gate, a judge batch, one more draft for the ones sent back) and prints each
  daf's screens and naturalness; `--no-judge` skips the judge. For review rounds: `npm run translate:try -- bekhorot/3
  bekhorot/4 --judge` prints the stored Hebrew, a fresh draft, the gate's verdict, the lexical screens
  (`src/note/screenHe.ts`: calques, a sentence over 28 words, a bare "פסוק", an echoed question; triage only, never a
  gate) and the judge's reading, and stores nothing. Over the archive: `npm run notes:audit:he -- --all --review` (after
  `npm run notes:export`) screens every stored translation, judges each beside its English note in one batch
  (`scripts/audit-he.ts`, its own file: the English audit's shape is page text and the grounding gate through and through),
  and writes `data/audit/he-<date>.json` with a naturalness histogram, the reasons and the screens; it prints the
  `translate --force --dapim` command for the ones sent back. Bump `TRANSLATE_JUDGE_PROMPT_VERSION` when the judge's
  criteria change enough that old verdicts should not be trusted.
- **`HE_PUBLIC`** (wrangler var). `"0"`: Pre-Release, meaning `<meta name="robots" content="noindex">` on every `/he`
  page, no `/he` URLs in the sitemap, no hreflang, a notice under the header and a tag on the switch. `"1"` after the
  Israeli reviewer round: indexed, in the sitemap with `xhtml:link` alternates, `hreflang` in every page head.
- **Strings.** Every chrome string is in `src/i18n/{en,he}.ts` (`test/i18n.test.ts`: same keys, no em dashes, no Latin
  in Hebrew outside an allowlist). The About page's Hebrew is `src/render/aboutHe.ts`. Social card: `python3
  scripts/og-card.py --lang he` → `public/og-he.png`.
- **Yiddish** rides the same machinery: add it to `ENABLED_LANGS`, a `yi.ts` table, a style guide, and the router,
  templates, cache keys, sitemap and cron follow.

## Share cards (added 2026-09-22)

Every English daf page, and the homepage, points `og:image` / `twitter:image` at a per-daf 1200x630 card carrying
the AI note itself, the summary (`/og/<slug>/<daf>/<token>.png`, code in `src/og/`). Joe's call after the first
day: the notes are beautiful and best first; the question waits on the page; and a shared bubble is only the link, so
a text thread shows the card and no pasted words. Hebrew pages keep the static `public/og-he.png`; the template
already takes a language, so a Hebrew card is a small later build.

- **Drawn by Cloudflare Browser Rendering** (the `browser` binding in `wrangler.jsonc`, `@cloudflare/puppeteer`).
  Free plan, verified in the docs 2026-09-21: 10 browser-minutes a day, 3 concurrent browsers, one new instance
  every 20 seconds, 60 s idle timeout. One launch per invocation; the template with its embedded fonts loads once,
  then each card swaps the texts and takes a screenshot (about a second a card; the first, with the launch, a few
  seconds). `wrangler dev` runs a local headless Chromium for the binding (it downloads one on first use); never set
  `"remote": true` on the binding, that spends the daily budget from a laptop.
- **Never on a visit.** Cards are drawn by the card cron (`20 6,18 * * *`, `runCardBake` in `src/og/bake.ts`,
  20 minutes after each note bake so a browser hang can never touch the notes; the 4th of the account's 5 cron
  slots) and by `POST /admin/og/bake`. The image route only reads KV. This is the 2026-09-20 lesson applied: an
  anonymous request must not spend a metered resource.
- **Storage.** KV `og:v1:<slug>:<daf>` holds the PNG (60 to 130 KB); the key's metadata says which note it shows
  (`of` = the note's `generatedAt`), the design (`cv` = `CARD_VERSION`), the cycle whose date it carries, the URL
  token, size and render time. `ogcursor:v1` is the trickle's place in the cycle. 2,711 cards are about 250 MB of
  the free 1 GB; the bake writes at most a few dozen keys a day.
- **The page decides.** `dafPageResponse` reads the card's metadata (never its bytes) and puts the per-daf URL in the
  head only while the card shows the note on the page; otherwise the static card. So a card never carries a
  question other than the one in the HTML that references it. The residual window is the page's own edge TTL:
  an English page with a note but no card yet is cached 600 s instead of 3600 (`x-daf-card: no`), so the cron's
  work reaches the head within ten minutes. KV takes up to a minute to propagate, so a crawler can once see the
  static card for a brand-new one; not engineered around. Notes written by the on-visit self-heal or the
  newsletter's last-resort bake wait for the next 06:20/18:20 run (up to 12 h) before their card exists.
- **Versioned URL.** The token is fnv1a of design, cycle, the note's `generatedAt` and the render time: any redraw is
  a new URL, which is the only reliable cache bust for Facebook, Slack and the edge (the PNG is served
  `immutable` for a year). An old token 302s to the current URL; a card that is not there yet 302s to `/og.png`;
  both `no-store`. A design-stale card (older `cv`, or another cycle's date) keeps serving until redrawn: only a
  changed question retires a card, so a design change never blanks the site.
- **Order of work per run.** Tomorrow, today, the day after, yesterday; then `OG_TRICKLE_PER_RUN` (var, 10) archive
  cards from the cursor, so the archive fills unattended (two runs a day). Faster: `npm run og:backfill -- --site
  https://daf-yomi.dev --all` (chunks of 15 per admin call, 21 s between chunks for the instance-rate limit,
  current cards skipped without a launch). At about a second a card the free plan's 10 minutes draw roughly 450
  a day, so `--all` takes about six mornings; it stops on the day's budget and says so (exit 3). `--window 3`
  and `--dapim slug/daf,…` for the near days.
- **Two different 429s from `launch`.** The instance rate (wait 21 s; the script retries once) and the daily budget
  ("Browser time limit exceeded for today": stop). Both surface as HTTP 429 from `/admin/og/bake` with `kind`.
  A cron launch that lands within 20 s of a backfill chunk is the likely collision; the cron just logs it.
- **Design.** `src/og/card.ts` (`CARD_VERSION` 2): the six-Orders bar with a tick at the daf, the wordmark, an AI NOTE
  chip, tractate and daf with the Hebrew title, the civil and Hebrew dates, the note's summary in Source Serif 4
  stepped down from 34 px to 22 px until it fits (never cut; an 80-word note lands near 26 px), a footer with the
  domain and "Written by Claude, an AI. Not a scholar." Version 1 (2026-09-22, a few hours) showed the question in
  italic at up to 62 px; its cards keep serving until redrawn.
  Fonts are woff2 subsets fetched once by `npm run og:fonts` into `src/og/fonts/` (latin, latin-ext, hebrew;
  138 KB) and embedded as data URIs, so a render never touches the network. Preview a card locally with
  `npm run og:preview -- bekhorot/2` (writes `scratch/og-bekhorot-2.html`; open it, or screenshot it with
  Playwright). A design change is a `CARD_VERSION` bump; the trickle or the backfill redraws the archive.
- **Verify after a change.** `curl -s "https://daf-yomi.dev/?nocache=1" | grep -E 'og:image|twitter:image'` shows a
  `/og/…` URL; fetch it and look; `/api/today.json` carries `note.card`; `/admin/og/status?date=YYYY-MM-DD` shows
  the stored metadata; then paste a permalink into opengraph.xyz, iMessage, WhatsApp or Slack: "done" is the
  question visible in a real preview. Facebook's sharing debugger re-scrapes a URL on demand.
- **"Share this note"** (`public/app.js`, the right-hand pillar under the note's text; the sign-up is the left one): the
  permalink and nothing else, through the share
  sheet on a phone (`navigator.share({ url })`) and the clipboard elsewhere, with select-and-copy as the fallback when
  a browser refuses the clipboard API. No words travel with the link on purpose: the thread shows the card. Nothing
  is recorded; the privacy page stays true.

## Measured CPU (wrangler tail, 2026-09-20, after the formatter/cache fixes)

| Request | CPU | Notes |
|---|---|---|
| Daf page, first visit ever (Sefaria fetch + sanitize + KV write) | 14 ms | once per daf per 30 days |
| Daf page, KV-warm, edge-bypassed | 7 ms | |
| Daf page, edge hit | 1 ms | what almost every visitor gets |
| `/` today (edge hit) | 2–3 ms | |
| Tractate page (KV list + 100+ cells) | 11–13 ms | cached 30 min |
| `/feed.xml` | 7 ms | 14 KV reads |
| `POST /admin/og/bake`, 3 cards in one browser launch (2026-09-22) | 87 ms | wall 3.7 s; about 25 ms CPU a card: the CDP round trips and the PNG decode. A 15-card chunk is a few hundred ms and was accepted |
| Daf page, edge-bypassed, with the card metadata read | 5 ms | |
| `/og/<slug>/<daf>/<token>.png`, old token (302) | 3 ms | a hit serves from KV, then the edge |

Before the fixes, an uncached tractate page cost 55 ms and still returned OK, and on 2026-09-22 card bakes of
87 ms (three cards) and a few hundred ms (fifteen) returned OK too. So either the free plan's documented 10 ms is
enforced softly or this account is on Workers Paid. **I am uncertain which**; check Workers & Pages → Plans in
the dashboard. If a card bake ever dies with error 1102, lower the backfill's `--chunk` and `OG_TRICKLE_PER_RUN`. Either way, keep an eye on `wrangler tail` after changes to
rendering, and remember the cron run (up to 3 note generations) is the heaviest single invocation.

## Limits that matter (free plan, verified 2026-09-20 in Cloudflare docs)

- 100,000 requests/day, 10 ms CPU per request and per cron invocation, 50 subrequests per request.
- 5 cron triggers per account; this Worker uses 4 (two bakes, one hourly newsletter tick, the card bake at 06:20/18:20).
- **KV: 1,000 writes/day on free, hard-enforced** (hit it 2026-09-20 during re-bakes: "KV put() limit exceeded
  for the day"; resets at midnight UTC). That is why Sefaria text and generation locks live in the edge Cache
  API, not KV: a crawl of all 2,711 permalinks would otherwise burn 5,000 writes. KV now takes roughly one
  write per note (≈3/day from the cron) plus the 28 one-time ref lookups for the irregular tractates.
  A big forced re-bake of the archive still costs one KV write per daf, so keep those under ~900 a day or
  move to Workers Paid.
- If any of this binds, Workers Paid is $5/month and lifts CPU to 30 s.

## Incident, 2026-09-20: a crawl generated 2,456 notes in an hour (~$190)

Something (a crawler, almost certainly following `/sitemap.xml`) fetched every permalink between 18:00 and
19:00 UTC. Each page without a note ran the on-visit self-heal, which called Claude. Recorded usage:
20.1M input + 3.1M output tokens, $178 at list price, plus ~135 earlier notes without usage recorded.
Root cause: anonymous page views could trigger paid API calls, and the sitemap advertised 2,711 of them.
Fixes: self-heal only within `HEAL_WINDOW_DAYS` (3) of today; `DAILY_GENERATION_CAP` (18/UTC day since the map of the page joined the cron; 12 before, KV
counter, admin `--force` exempt); text cache and locks moved off KV. Side effect: 2,590 of 2,711 dapim now
have notes (style .5), the rest say "not written". Last line of defence is the monthly spend limit in the
Anthropic Console, which the code cannot set.

## Style changes and re-bakes (Joe, 2026-09-21)

Every daf already has a note, so the nightly cron re-bakes the near targets (tomorrow, today, the day
after) whenever their note predates the current `PROMPT_VERSION` (≈3 notes, ~25¢). New rules therefore
reach the live page within a day. The archive (2,711 notes, ~$200 a pass) is re-baked deliberately and
rarely, once or twice a year at most, and must be spread over 3 days on the free plan (1,000 KV
writes/day) or run on Workers Paid.

## Note quality audits and precision re-bakes (2026-09-22)

The grounding gate checks words; the **judge** (`src/note/judge.ts`, `prompts/daf-judge.md`) reads. Given the page and
a note it answers: is the question answered on the page itself (with the page's words quoted), does the question reach
an idea or is it only mechanics, does the summary state anything the page contradicts. The verdict is derived in code
(`verifyJudgment`): a quotation that is not really on the page is discounted, so a hallucinated "the page answers this"
never re-bakes a note. Re-bake iff answered-on-page (verified), or only mechanics, or a verified factual contradiction.
"Partly answered", "case", and interpretive overreach are recorded and kept.

Where it runs:
- **Live**: the cron and `POST /admin/bake` pass `judge: "once"`: one judge call after a draft passes the gate; a
  `rebake` verdict buys one more draft with the judge's feedback, stored if it passes the gate (no second judge). At most
  three drafts and one judge per bake, about ten cents a day on the cron. The stored note carries `review` (the verdict on
  the draft the judge saw, and `rewritten` when a later draft is what was stored). `judge=off` on the admin URL skips it.
- **Offline, over the archive**: `npm run notes:export` (GET `/admin/note` for every daf, six in flight, into
  `.cache/notes.json`; wrangler's bulk get caps at 100 keys per request so it is not used), then `npm run notes:audit --
  --all --review`: the current gate over every stored note, the lexical screens (`src/note/screen.ts`, triage only), the
  page text fetched once into `.cache/text/` (paced 1.5 s, Retry-After honoured; ~70 minutes the first time), and one
  Message Batch of judge calls (half price; batch ids in `.cache/batches/`, so a rerun polls instead of paying again).
  Output `data/audit/<date>.json`, committed: every daf's verdict, verified quotes, screens, feedback. `--review` prints a
  spread (answered-on-page, mechanics, summary-wrong, partly, keep) to read before anything is touched.
- **The re-bake**: `npm run notes:rebake -- --audit data/audit/<date>.json`. Offline through the Batch API: a draft that
  sees its old note and the judge's feedback, the gate, a judge batch, one more draft if sent back; at most three drafts and
  two judge readings per daf. Stored through `POST /admin/note/put`, which re-runs the gate against the edge-cached page,
  refuses a note not written under the current `PROMPT_VERSION`, refuses unless `replaces` equals the stored
  `generatedAt` (so the cron's near-day bake is never overwritten; today ± 3 is skipped anyway), sets `generatedAt`,
  `sources` and `wordCount` itself, and answers 429 `kind: "kv-budget"` when KV's daily write limit bites. Notes that never
  satisfy the judge are left as they were and listed. Outcomes in `<date>.outcomes.json`; the run resumes from it.
  It prints the `translate --dapim` (re-baked dapim that had a Hebrew note) and `og:backfill --dapim` (that had a card)
  commands to run next.

Budgets. KV writes: 1,000 a day on the free plan, the cron needs ~35 (notes, translations, `gen:`, near cards, the
trickle); the re-bake stops at `--budget` (default 850) counted in `.cache/kv-writes.json`, and every put, translation
and card is one write, so pair a day's English puts with their Hebrew and leave the cards for the next morning (Browser
Rendering: 10 minutes a day, roughly 450 cards). Money, Opus 5 at batch price: the judge over 2,711 notes ≈ $120 to
$195 (estimate; measured figure goes here after the first run); a re-bake ≈ $0.10 to $0.17 per daf. Both scripts print
what they spent. Check the Anthropic Console spend limit before a full pass.

Known wrinkle: a permalink cached at the edge (up to an hour) can briefly show the old question above a card that
already carries the new one, because old card tokens 302 to the current card. Accept it; `?nocache=1` shows the truth.

## Failure modes

- **Note missing on today's page**: the cron either had no API key, hit the generation budget, or the
  grounding check failed twice. `npm run tail` during a cron window or POST `/admin/bake?date=YYYY-MM-DD`
  to see the outcome JSON.
- **502 "The text did not load"**: Sefaria unreachable or returned an error for that ref. Cached texts
  keep serving for 30 days; only never-visited pages fail.
- **Wrong daf**: the schedule is offline and deterministic. Run `npm run verify:cycle` before believing it.
  Sefaria's calendar endpoint returns 429 (`retry-after: 30`) after a burst of roughly 75 requests; the
  script paces itself (default 1.2 s) and honours Retry-After, so a full remaining-cycle check takes minutes.
- **A shared link shows the static card, not the question**: the page had no current card when it was cached. Check
  `/admin/og/status?date=…` (is `current` true?), then `npm run og:backfill -- --site https://daf-yomi.dev --window 3`,
  then `?nocache=1` on the page. If `/admin/og/bake` answers 429 with `kind: "budget"`, the day's 10 browser-minutes
  are gone; the cron catches up tomorrow. With `kind: "other"`, read `npm run tail` during a bake.
- **Stale page after a deploy**: edge-cache keys include the build id (`--var BUILD:<sha>` in `npm run deploy`),
  so a deploy never serves the previous version. A bare `wrangler deploy` (without the var) falls back to the
  key `dev` and can serve stale HTML for up to an hour; use `npm run deploy`.
