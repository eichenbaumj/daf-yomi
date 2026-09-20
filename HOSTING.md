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
