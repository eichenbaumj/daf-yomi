# The daf by email: how it runs

One message a day per reader: the day's daf, the AI note and its question, one button to the page. Sent by
this Worker at each reader's own hour, in their own time zone. Decided and specified 2026-09-20 (plan in
Joe's `~/.claude/plans/feature-idea-for-daf-ancient-salamander.md`); code under `src/newsletter/` and
`src/render/email.ts`.

## Moving parts

| Piece | Where | Notes |
|---|---|---|
| Readers, ledger, rendered issues | D1 `NEWSLETTER_DB` (`daf-yomi-newsletter`) | Schema in `migrations/`. Addresses live in one column; events and the suppression list hold only an HMAC of the address. |
| Hourly tick | cron `0 * * * *` → `runSendTick` in `src/newsletter/send.ts` | Dispatched on `controller.cron` in `src/index.ts`; anything else runs the bake. |
| Who is due | `src/newsletter/plan.ts` (pure) | `slot = localHour - chosenHour`; due at slot 0, caught up to `CATCHUP_HOURS` (3) later if no ledger row exists. Evening readers get tomorrow's daf. |
| The email | `src/render/email.ts` (pure, no Sefaria) | Rendered once per (date, variant) into `editions`, personalised per reader by string replace (`__UNSUB__`, `__PREFS__`, `__EMAIL__`, `__CONFIRMED__`, held-for-Shabbat block). |
| Carrier | Resend batch API behind `EmailProvider` (`src/newsletter/provider.ts`, `resend.ts`) | Chunks of 50 with `Idempotency-Key = daf:<date>:<variant>:<firstId>:<n>`; a replay returns the original response, a 409 counts as sent. Free tier: 100 emails/day. Swap to Amazon SES near 85 readers (an alert fires at 80). |
| Opt-in | `POST /newsletter` → confirmation email → `GET /newsletter/confirm?t=` | Turnstile, per-IP limit, per-address throttle, suppression check, KV daily cap (`confirm:<date>`, 40). No row until the link is clicked. |
| Unsubscribe | `GET|POST /newsletter/u/<token>` | The page's button and RFC 8058 one-click both POST here; idempotent 200. Address and zone are deleted on the spot (row tombstoned, token kept so repeat POSTs stay 200). |
| Preferences | `GET|POST /newsletter/prefs/<token>` | Hour, zone, edition, hold-Shabbat. |
| Archive | `GET /newsletter/issue/YYYY-MM-DD` | Exactly what was sent (from `editions`), `noindex`. Doubles as the design preview. |
| Provider events | `POST /newsletter/hooks/resend` | Svix-signed. Hard bounce → `bounced`; complaint → `complained`; both suppressed for good. Duplicate `svix-id`s are ignored. |
| Alerts | `src/newsletter/alerts.ts` via the `ALERT` send_email binding | Free to a verified address. Without the binding, alerts are console errors only. |
| Admin | `GET /admin/newsletter/status`, `POST /admin/newsletter/{send,tick,rebuild-edition}` | Bearer `ADMIN_TOKEN`. `send?date=&dry=1` returns the HTML; `send?date=&to=` mails one issue; `tick?time=<ms>` runs a tick now. |

Bindings and vars: see `wrangler.jsonc`. Secrets: `RESEND_API_KEY`, `TOKEN_HMAC_SECRET`, `TURNSTILE_SECRET_KEY`,
`RESEND_WEBHOOK_SECRET` (plus the existing `ADMIN_TOKEN`, `ANTHROPIC_API_KEY`). `NEWSLETTER_PUBLIC=1` shows
the nav tab and opens the form; until then `/newsletter` says the email is not open yet.

## A day, in UTC

```
06:00  bake     ensureNote(D+1), ensureNote(D), ensureNote(D+2)         → KV note:v1:*
hh:00  tick     zones whose local hour is within 3 h of a chosen hour → due readers
                getNote(daf) from KV → render once → reserve rows → POST /emails/batch → mark sent → send_runs row
                note missing: defer at slots 0..2; at slot 3 call ensureNote once, then send the full issue
                or the honest "not written in time" card, and alert
00:00  tick     also: fail reserved rows older than yesterday (never send a stale issue), housekeeping,
                provider-swap alert at 80 active readers
18:00  bake     retries anything still missing
```

## Running it

```bash
npm test && npm run typecheck
npm run d1:migrate:local                         # once per machine; `npm run d1:migrate` for production
npm run email:preview -- 2026-09-21 > /tmp/issue.html && open /tmp/issue.html
npm run email:preview -- 2026-09-21 --nonote --text
npx wrangler dev                                  # then:
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=0+*+*+*+*"     # the hourly tick
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=0+6+*+*+*"     # the bake
npm run newsletter:test -- --site http://localhost:8787 --date 2026-09-21 --dry > /tmp/issue.html
npm run newsletter:test -- --site https://daf-yomi.dev --date 2026-09-21 --to you@example.com
npm run newsletter:test -- --site https://daf-yomi.dev --status
```

Add a reader by hand (before the public form is open):

```bash
npx wrangler d1 execute daf-yomi-newsletter --remote --command \
  "INSERT INTO subscribers (email,email_hash,tz,hour,edition,hold_shabbat,status,unsub_token,consent_version,created_at,confirmed_at,updated_at)
   VALUES ('you@example.com','manual','America/New_York',6,'today',0,'active','<48 lowercase hex>','manual',datetime('now'),datetime('now'),datetime('now'))"
```

(`email_hash` only matters for bounce and complaint handling; the webhook computes the HMAC of the address,
so a hand-inserted row wants the real hash. `node -e` with the same HMAC as `src/newsletter/tokens.ts`, or
re-subscribe through the form once it is open.)

## When something goes wrong

- **A reader got no issue.** `--status` shows `send_runs` for the last 24 ticks: `deferred` means the note
  was not written by then; `failed` means the provider refused five times (see `last_error` on the
  `deliveries` row). Rows never go out late: at 00:00 UTC anything still reserved for an older date is failed.
- **Provider 429 or 5xx.** Rows stay `reserved`, the same batch key is replayed next hour. Nothing to do.
- **Provider 401/403.** The API key is wrong or revoked; rows are retried each hour until fixed (five attempts).
- **Resend free tier exhausted (100/day).** Confirmations count too. The tick's alert at 80 active readers is the
  cue to write the SES implementation of `EmailProvider` and switch; the ledger carries idempotency for a
  provider without keys.
- **Wrong text in a sent issue.** `POST /admin/newsletter/rebuild-edition?date=` drops the stored edition;
  the next tick re-renders. Already-sent copies are what they are; the archive shows what went out.
- **A bounced or complained address wants back in.** It is on `suppressions`; delete the row by hand after
  checking why. The confirm page tells such readers to write in.
- **Gmail shows the Hebrew title flipping the layout.** Set `EMAIL_HEBREW=0` and deploy; the only RTL run
  disappears.

## Limits that shape the code

Free plan: 10 ms CPU per invocation (a tick is a few ms of string work), 50 external subrequests (one per
batch of 50), D1 50 queries per invocation (a tick is about a dozen; the DB layer throws past 45), KV
1,000 writes/day (the newsletter adds at most 40 `confirm:` counter writes). Workers Paid ($5/mo) lifts all
of these if the list ever needs it.
