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
  public form `TURNSTILE_SECRET_KEY`, `RESEND_WEBHOOK_SECRET`. Vars in `wrangler.jsonc`: `NEWSLETTER_FROM`,
  `NEWSLETTER_REPLY_TO`, `CATCHUP_HOURS`, `EMAIL_HEBREW`, `NEWSLETTER_PUBLIC`, `TURNSTILE_SITE_KEY`.
- DNS for sending (Resend dashboard gives the values; all records DNS-only, not proxied): sending domain
  `news.daf-yomi.dev`: MX `send.news`, TXT SPF on `send.news`, TXT `resend._domainkey.news`; add
  `_dmarc.news.daf-yomi.dev` `v=DMARC1; p=none; rua=mailto:dmarc@daf-yomi.dev`, and on the apex
  `_dmarc.daf-yomi.dev` `v=DMARC1; p=reject; rua=mailto:dmarc@daf-yomi.dev`. Email Routing (free) on the
  apex so `daf@daf-yomi.dev` (Reply-To) and `dmarc@` reach Joe; its MX/SPF records live on the apex and do
  not collide with Resend's, which live on subdomains.
- The third cron (`0 * * * *`) is the send tick; 3 of the account's 5 free cron slots are now used.
- Limits the tick lives inside: D1 free 50 queries per invocation (a tick uses about a dozen), 50 external
  subrequests (one per batch of 50 readers), 10 ms CPU. Operator notes in NEWSLETTER.md.

## Measured CPU (wrangler tail, 2026-09-20, after the formatter/cache fixes)

| Request | CPU | Notes |
|---|---|---|
| Daf page, first visit ever (Sefaria fetch + sanitize + KV write) | 14 ms | once per daf per 30 days |
| Daf page, KV-warm, edge-bypassed | 7 ms | |
| Daf page, edge hit | 1 ms | what almost every visitor gets |
| `/` today (edge hit) | 2–3 ms | |
| Tractate page (KV list + 100+ cells) | 11–13 ms | cached 30 min |
| `/feed.xml` | 7 ms | 14 KV reads |

Before the fixes, an uncached tractate page cost 55 ms and still returned OK. So either the free plan's
documented 10 ms is enforced softly or this account is on Workers Paid. **I am uncertain which**; check
Workers & Pages → Plans in the dashboard. Either way, keep an eye on `wrangler tail` after changes to
rendering, and remember the cron run (up to 3 note generations) is the heaviest single invocation.

## Limits that matter (free plan, verified 2026-09-20 in Cloudflare docs)

- 100,000 requests/day, 10 ms CPU per request and per cron invocation, 50 subrequests per request.
- 5 cron triggers per account; this Worker uses 3 (two bakes, one hourly newsletter tick).
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
Fixes: self-heal only within `HEAL_WINDOW_DAYS` (3) of today; `DAILY_GENERATION_CAP` (12/UTC day, KV
counter, admin `--force` exempt); text cache and locks moved off KV. Side effect: 2,590 of 2,711 dapim now
have notes (style .5), the rest say "not written". Last line of defence is the monthly spend limit in the
Anthropic Console, which the code cannot set.

## Failure modes

- **Note missing on today's page**: the cron either had no API key, hit the generation budget, or the
  grounding check failed twice. `npm run tail` during a cron window or POST `/admin/bake?date=YYYY-MM-DD`
  to see the outcome JSON.
- **502 "The text did not load"**: Sefaria unreachable or returned an error for that ref. Cached texts
  keep serving for 30 days; only never-visited pages fail.
- **Wrong daf**: the schedule is offline and deterministic. Run `npm run verify:cycle` before believing it.
  Sefaria's calendar endpoint returns 429 (`retry-after: 30`) after a burst of roughly 75 requests; the
  script paces itself (default 1.2 s) and honours Retry-After, so a full remaining-cycle check takes minutes.
- **Stale page after a deploy**: edge-cache keys include the build id (`--var BUILD:<sha>` in `npm run deploy`),
  so a deploy never serves the previous version. A bare `wrangler deploy` (without the var) falls back to the
  key `dev` and can serve stale HTML for up to an hour; use `npm run deploy`.
