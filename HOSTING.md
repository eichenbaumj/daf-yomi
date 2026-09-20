# Hosting

Cloudflare Worker `daf-yomi` on Joe's account (joe@group17a.com, account id in wrangler's `whoami`).
Wrangler config: `wrangler.jsonc`. KV namespace `DAF_KV` (id in the config).

## Deploy

```bash
npm test && npm run typecheck
npm run deploy                     # wrangler deploy → https://daf-yomi.<subdomain>.workers.dev
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
- Backfill so "yesterday" has a note: `ADMIN_TOKEN=… npm run backfill -- --site https://… --from <2 weeks ago> --to <today>`.
- Cron: `wrangler triggers` are in the config (06:00 and 18:00 UTC). Check the Workers dashboard →
  Triggers → Cron events after the first night.

## Custom domain (when Joe picks a name)

Workers custom domains are proxied by Cloudflare by design (unlike the Lovable gray-cloud rule for the
warehouse). Add `"routes": [{ "pattern": "example.org", "custom_domain": true }]` to `wrangler.jsonc`
for a zone on this account and deploy; Cloudflare creates the DNS record and certificate. Then set
`SITE_URL` if anything ever needs an absolute URL outside the request origin (nothing does today: the
pages derive `origin` from the request).

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
- 5 cron triggers per account; this Worker uses 2.
- KV: generous read quota; ~1,000 writes/day on free. Each daf page write is a text cache (2 keys) and a note.
- If any of this binds, Workers Paid is $5/month and lifts CPU to 30 s.

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
