# Today's Daf

An English-forward Daf Yomi page. Every day: the day's page of Talmud in
English (Rabbi Adin Even-Israel Steinsaltz's translation, via Sefaria), where it
sits in the cycle, and a short note written by an AI that says so.

Live at **https://daf-yomi.dev**. Free, no accounts, no tracking. One Cloudflare Worker, no framework.

## What it does

- `/` today's daf, by the civil date in the visitor's timezone
- `/bekhorot/2` a permalink for every one of the 2,711 dapim
- `/bekhorot` a tractate page: chapters, Steinsaltz's introduction, every daf with its date
- `/tractates`, `/about`, `/feed.xml` (RSS, last 14 days), `/api/today.json`, `/api/<slug>/<n>.json`
- `/newsletter` the daf by email: one message a day at the reader's own hour (see [NEWSLETTER.md](NEWSLETTER.md))
- `/yesterday`, `/tomorrow`, `/date/YYYY-MM-DD` redirect to the right page
- `/og/<slug>/<n>/<token>.png` the share card behind a forwarded link: the AI note on parchment, drawn per daf by
  Cloudflare Browser Rendering on a cron, never on a visit (see [HOSTING.md](HOSTING.md), "Share cards")
- Toggles: Hebrew/Aramaic alongside the English; "Talmud only" hides the interpolated explanation; "Hide the daf"
  keeps just the note. "Share this note" under the note copies the permalink, and only that, so a text thread
  shows the card (a share sheet on phones); nothing is recorded

## How it works

```
visitor → Worker fetch()
           ├─ date (request.cf.timezone) → daf     offline, @hebcal/learning (public-domain daf.el port)
           ├─ text: edge cache (30 d) → Sefaria v3 texts API (both amudim, English + Hebrew)
           └─ note: KV → else render "pending" and generate in ctx.waitUntil
cron (06:00 and 18:00 UTC) → bake tomorrow's, today's and the day after's note, backfill the last 7 days, ≤3 generations/run
cron (hourly) → the newsletter tick: render the issue once, send it to every reader whose local hour has come (D1 + Resend)
cron (06:20 and 18:20 UTC) → draw the share cards for the near days plus a trickle of the archive (Browser Rendering → KV og:v1:*)
```

- **Schedule**: `src/daf/schedule.ts`. Cycle 14 runs 5 Jan 2020 to 7 Jun 2027. The tractate table
  (`data/tractates.json`) is baked by `npm run build:tractates` from hebcal's lengths plus Sefaria's
  index metadata, and sums to exactly 2,711 days. `npm run verify:cycle` diffs our schedule against
  Sefaria's calendar API date by date.
- **Irregular days**: Shekalim (Yerushalmi), Kinnim and Middot (Mishnah) have no `{Tractate}.{n}a` on
  Sefaria; for those we ask Sefaria's calendar which ref it uses for that date and cache the answer.
- **Sanitizing**: `src/sefaria/sanitize.ts` allowlists inline tags, vets hrefs, drops footnotes, and wraps
  non-bold English runs in `<span class="elu">` (bold = the Talmud's words, plain = Steinsaltz's gloss).
- **The note**: `prompts/daf-note.md` is the house style, `src/note/generate.ts` calls Claude
  (`claude-opus-5`, structured output), and `src/note/grounding.ts` enforces in code what the prompt asks:
  quotes must appear verbatim in the text, no later authorities, no sermon, no em dashes, one question.
  Two failures and the day goes without a note rather than with a wrong one.

## Develop

```bash
npm install
cp .dev.vars.example .dev.vars     # add ANTHROPIC_API_KEY to see notes locally (optional)
npm run dev                        # http://localhost:8787
npm test && npm run typecheck
```

Trigger the cron locally: `curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=0+6+*+*+*"`.

Try the note style on a few dapim without touching KV:

```bash
ANTHROPIC_API_KEY=... npm run bake:note -- bekhorot/2 berakhot/2 shabbat/31 2026-09-21
# or, against the live site (uses ADMIN_TOKEN from .dev.vars):
npm run backfill -- --site https://daf-yomi.dev --from 2026-09-20 --to 2026-09-21 --force
```

## Deploy

See [HOSTING.md](HOSTING.md). Short version: `npm run deploy`, set the two secrets once
(`ANTHROPIC_API_KEY`, `ADMIN_TOKEN`), backfill recent notes with `npm run backfill`.

## Licenses

Code: MIT. Text: The William Davidson Talmud (Koren Noé edition) via Sefaria, CC BY-NC 4.0;
Shekalim from Guggenheimer's Jerusalem Talmud (CC BY); Kinnim/Middot from Sefaria's Mishnah.
Every page credits the versions it shows. This site is non-commercial and will stay that way.
