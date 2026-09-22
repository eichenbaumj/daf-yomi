/**
 * The hourly tick: work out who is due in every time zone, render each edition
 * once, reserve the ledger rows, and hand chunks of readers to the provider
 * with an idempotency key, so a crash between the call and the bookkeeping
 * replays the same request instead of sending twice.
 *
 * Budget on the free plan: 10 ms CPU, 50 external subrequests, 50 D1 queries
 * per invocation. A typical tick is one or two batches and about a dozen
 * statements; the D1 layer throws before the cap so a design mistake is loud.
 */
import type { Env } from "../types";
import { addDays, dafForDate, longDate, todayIn, ymd, type DafRef } from "../daf/schedule";
import { dafLabel } from "../daf/tractates";
import { getNote, type DafNote } from "../note/store";
import { ensureNote } from "../note/generate";
import { heldBlock, personalize, renderIssue, type RenderedIssue } from "../render/email";
import { d1NewsletterDb, type EditionRow, type NewsletterDb, type SendRunRow, type SubscriberRow, type Variant } from "./db";
import { BATCH_SIZE, MAX_ATTEMPTS, batchKey, chunk, dafDateOf, heldDafimFor, localClock, planTick, type PlanAction } from "./plan";
import type { EmailProvider, OutboundEmail } from "./provider";
import { issueHeaders, resendProvider } from "./resend";
import { isIsraelTz, isRestDay } from "./hebcal";
import { siteOrigin } from "./origin";
import { alert } from "./alerts";
import { withTimeout } from "../util";

export const SEND_CRON = "0 * * * *";
const MAX_BATCHES_PER_TICK = 20;
const ENSURE_TIMEOUT_MS = 25_000;
/** Resend's free tier is 100 emails a day: tell Joe to swap providers well before the list reaches it. */
const PROVIDER_SWAP_ALERT_AT = 80;

export interface TickDeps {
  db?: NewsletterDb;
  provider?: EmailProvider;
  now?: Date;
  getNote?: (env: Env, ref: DafRef) => Promise<DafNote | null>;
  ensure?: (env: Env, ref: DafRef) => Promise<unknown>;
  alert?: typeof alert;
}

export function tickId(now: Date): string {
  return now.toISOString().slice(0, 13);
}

/** Render one edition (date × variant) with reader placeholders; stored once and personalised per reader. */
export function buildEdition(env: Env, editionDate: string, variant: Variant, note: DafNote | null, now: Date): EditionRow {
  const date = dafDateOf(editionDate);
  const ref = dafForDate(date);
  const r = renderIssue({ origin: siteOrigin(env), siteName: env.SITE_NAME, ref, date, note: variant === "full" ? note : null, hebrew: env.EMAIL_HEBREW !== "0" });
  return { edition_date: editionDate, variant, slug: ref.tractate.slug, daf: ref.daf, note_present: variant === "full" ? 1 : 0, subject: r.subject, preheader: r.preheader, html: r.html, text: r.text, rendered_at: now.toISOString() };
}

function personalFor(env: Env, origin: string, sub: SubscriberRow, sendDate: Date): { unsubUrl: string; prefsUrl: string; email: string; confirmedDate: string; heldHtml: string; heldText: string } {
  const held = sub.hold_shabbat ? heldDafimFor(sub, sendDate, isIsraelTz(sub.tz ?? ""), isRestDay) : [];
  const block = heldBlock(origin, held);
  const confirmed = sub.confirmed_at ? longDate(new Date(sub.confirmed_at)) : "the day you signed up";
  return { unsubUrl: `${origin}/newsletter/u/${sub.unsub_token}`, prefsUrl: `${origin}/newsletter/prefs/${sub.unsub_token}`, email: sub.email, confirmedDate: confirmed, heldHtml: block.html, heldText: block.text };
}

interface Group { key: string; editionDate: string; variant: Variant; actions: PlanAction[]; isNew: boolean }

export async function runSendTick(env: Env, scheduledTime: number, deps: TickDeps = {}): Promise<SendRunRow> {
  const started = Date.now();
  const now = deps.now ?? new Date(scheduledTime);
  const nowIso = now.toISOString();
  const tick = tickId(now);
  const log: string[] = [];
  const say = (s: string) => { log.push(s); console.log(`[tick ${tick}] ${s}`); };
  const notify = deps.alert ?? alert;
  const run: SendRunRow = { tick, due: 0, sent: 0, deferred: 0, held: 0, failed: 0, ms: 0, log: "" };
  const finish = async (db: NewsletterDb | null) => {
    run.ms = Date.now() - started;
    run.log = log.join("\n").slice(0, 4000);
    if (db) { try { await db.recordRun(run); } catch (e) { console.error("[tick] recordRun failed", e); } }
    return run;
  };

  const provider = deps.provider ?? (env.RESEND_API_KEY ? resendProvider(env.RESEND_API_KEY) : null);
  if (!provider) { say("no email provider configured (RESEND_API_KEY unset); nothing sent"); return finish(null); }
  if (!env.NEWSLETTER_DB && !deps.db) { say("NEWSLETTER_DB binding missing; nothing sent"); return finish(null); }
  const db = deps.db ?? d1NewsletterDb(env.NEWSLETTER_DB);
  const origin = siteOrigin(env);
  const catchupHours = Math.max(0, Number(env.CATCHUP_HOURS ?? 3) || 3);
  const readNote = deps.getNote ?? ((e: Env, ref: DafRef) => getNote(e.DAF_KV, ref.tractate, ref.daf));
  const ensure = deps.ensure ?? ((e: Env, ref: DafRef) => ensureNote(e, ref));

  try {
    // 1. Which zones and hours could be due right now.
    const tzs = await db.activeTimezones();
    if (tzs.length === 0) { say("no active subscribers"); return finish(db); }
    const clocks = new Map(tzs.map((tz) => [tz, localClock(tz, now)] as const));
    const pairs: { tz: string; hour: number }[] = [];
    for (const [tz, c] of clocks) for (let s = 0; s <= catchupHours; s++) pairs.push({ tz, hour: (c.hour - s + 24) % 24 });
    const subscribers = await db.activeSubscribersDue(pairs);
    if (subscribers.length === 0) { say(`nobody due in ${tzs.length} zone(s)`); return finish(db); }

    // 2. Candidate edition dates (yesterday, today, tomorrow in every due zone) and the ledger for them.
    const dateSet = new Set<string>();
    for (const c of clocks.values()) for (const k of [-1, 0, 1]) dateSet.add(ymd(addDays(c.date, k)));
    const dates = [...dateSet].sort();
    const deliveries = await db.deliveriesFor(dates, tzs);

    // 3. Notes, from KV only.
    const notes = new Map<string, DafNote | null>();
    const refFor = (d: string) => dafForDate(dafDateOf(d));
    for (const d of dates) notes.set(d, await readNote(env, refFor(d)));

    // 4. The plan.
    let actions = planTick({ now, catchupHours, subscribers, deliveries, notePresent: (d) => Boolean(notes.get(d)), isRestDay, isIsraelTz, clock: (tz) => clocks.get(tz) ?? localClock(tz, now) });
    run.due = actions.length;
    if (actions.length === 0) { say(`${subscribers.length} candidate(s), none due`); return finish(db); }

    // 5. Last-resort generation for a still-missing note, once per date, then send whatever exists.
    for (const d of new Set(actions.filter((a) => a.kind === "ensure-then-send").map((a) => a.editionDate))) {
      const ref = refFor(d);
      say(`${d}: note still missing at the last catch-up slot; trying once`);
      try { await withTimeout(ensure(env, ref), ENSURE_TIMEOUT_MS, "ensureNote"); } catch (e) { say(`${d}: ensureNote ${e instanceof Error ? e.message : String(e)}`); }
      notes.set(d, await readNote(env, ref));
      if (!notes.get(d)) await notify(env, "note-missing", `Sending ${dafLabel(ref.tractate, ref.daf)} without a note`, `The note for ${d} (${dafLabel(ref.tractate, ref.daf)}) was not written by the last catch-up slot. Readers get the honest "not written in time" card. Check the bake cron and the daily generation cap.`);
    }
    actions = actions.map((a) => (a.kind === "ensure-then-send" ? { ...a, kind: "send" as const } : a));
    run.deferred = actions.filter((a) => a.kind === "defer").length;
    if (run.deferred) say(`${run.deferred} deferred (note not written yet)`);

    // 6. Reserve ledger rows (new sends and holds); retries already have rows.
    const variantFor = (d: string): Variant => (notes.get(d) ? "full" : "nonote");
    const byDate = new Map<string, PlanAction[]>();
    for (const a of actions) { if (!byDate.has(a.editionDate)) byDate.set(a.editionDate, []); byDate.get(a.editionDate)!.push(a); }
    for (const [d, list] of byDate) {
      const rows = list.filter((a) => !a.retry && (a.kind === "send" || a.kind === "hold")).map((a) => ({ subscriber_id: a.sub.id, variant: variantFor(d), status: a.kind === "hold" ? ("held" as const) : ("reserved" as const) }));
      await db.reserve(d, rows, nowIso);
    }
    run.held = actions.filter((a) => a.kind === "hold").length;
    if (run.held) say(`${run.held} held for Shabbat or Yom Tov`);

    // 7. Groups: existing batch keys first (exact replays), then new chunks per (date, variant).
    const existingByKey = new Map<string, { editionDate: string; variant: Variant; ids: Set<number> }>();
    for (const d of deliveries) {
      if (d.status === "reserved" && d.batch_key) {
        if (!existingByKey.has(d.batch_key)) existingByKey.set(d.batch_key, { editionDate: d.edition_date, variant: d.variant as Variant, ids: new Set() });
        existingByKey.get(d.batch_key)!.ids.add(d.subscriber_id);
      }
    }
    const sendActions = actions.filter((a) => a.kind === "send");
    const groups: Group[] = [];
    const placed = new Set<number>();
    for (const [key, g] of existingByKey) {
      const list = sendActions.filter((a) => a.retry && a.editionDate === g.editionDate && g.ids.has(a.sub.id));
      if (!list.length) continue;
      list.forEach((a) => placed.add(a.sub.id));
      groups.push({ key, editionDate: g.editionDate, variant: g.variant, actions: list, isNew: false });
    }
    const fresh = new Map<string, PlanAction[]>();
    for (const a of sendActions) {
      if (placed.has(a.sub.id)) continue;
      // A retry whose row never got a batch key (crash between reserve and assign) keeps the row's variant.
      const rowVariant = a.retry ? (deliveries.find((d) => d.subscriber_id === a.sub.id && d.edition_date === a.editionDate)?.variant as Variant | undefined) : undefined;
      const k = `${a.editionDate}|${rowVariant ?? variantFor(a.editionDate)}`;
      if (!fresh.has(k)) fresh.set(k, []);
      fresh.get(k)!.push(a);
    }
    for (const [k, list] of fresh) {
      const [editionDate, variant] = k.split("|") as [string, Variant];
      list.sort((x, y) => x.sub.id - y.sub.id);
      for (const part of chunk(list, Math.min(BATCH_SIZE, provider.maxBatch))) {
        const key = batchKey(editionDate, variant, part[0]!.sub.id, part.length);
        groups.push({ key, editionDate, variant, actions: part, isNew: true });
      }
    }

    // 8. Editions needed, rendered once.
    const existingEditions = new Map<string, EditionRow>((await db.editionsFor(dates)).map((e) => [`${e.edition_date}|${e.variant}`, e]));
    const editionFor = async (d: string, v: Variant): Promise<EditionRow> => {
      const k = `${d}|${v}`;
      let e = existingEditions.get(k);
      if (!e) { e = buildEdition(env, d, v, notes.get(d) ?? null, now); await db.putEdition(e); existingEditions.set(k, e); say(`rendered ${d} ${v} (${e.html.length} bytes)`); }
      return e;
    };

    // 9. Send.
    const from = env.NEWSLETTER_FROM ?? `Today's Daf <daf@news.${env.CANONICAL_HOST ?? "daf-yomi.dev"}>`;
    const listDomain = env.CANONICAL_HOST ?? "daf-yomi.dev";
    let batches = 0;
    for (const g of groups) {
      if (batches >= MAX_BATCHES_PER_TICK) { say(`batch cap reached; ${groups.length - batches} group(s) wait for the next tick`); break; }
      batches++;
      const edition = await editionFor(g.editionDate, g.variant);
      if (g.isNew) await db.assignBatch(g.key, g.editionDate, g.actions.map((a) => a.sub.id), nowIso);
      const rendered: RenderedIssue = { subject: edition.subject, preheader: edition.preheader, html: edition.html, text: edition.text };
      const emails: OutboundEmail[] = g.actions.map((a) => {
        const p = personalize(rendered, personalFor(env, origin, a.sub, a.sendDate));
        const mail: OutboundEmail = { from, to: a.sub.email, subject: p.subject, html: p.html, text: p.text, headers: issueHeaders(origin, a.sub.unsub_token, listDomain), tag: g.editionDate };
        if (env.NEWSLETTER_REPLY_TO) mail.replyTo = env.NEWSLETTER_REPLY_TO;
        return mail;
      });
      const outcome = await provider.sendBatch(emails, g.key);
      if (outcome.ok) {
        await db.markSent(g.editionDate, g.actions.map((a, i) => ({ subscriber_id: a.sub.id, provider_id: outcome.ids[i] ?? "" })), nowIso);
        run.sent += g.actions.length;
        say(`${g.key}: sent ${g.actions.length}`);
      } else if (outcome.treatAsSent) {
        await db.markSent(g.editionDate, g.actions.map((a) => ({ subscriber_id: a.sub.id, provider_id: "replayed" })), nowIso);
        run.sent += g.actions.length;
        say(`${g.key}: provider already has this key (409); marked sent`);
      } else {
        // 429 and 5xx are the provider's problem; 401/403 mean our key is wrong and worth retrying once it is fixed.
        const willRetry = outcome.retryable || outcome.status === 401 || outcome.status === 403;
        const failAt = willRetry ? MAX_ATTEMPTS : 1;
        await db.markAttempt(g.key, `${outcome.status} ${outcome.body}`, failAt, nowIso);
        const attempts = Math.max(...g.actions.map((a) => (deliveries.find((d) => d.subscriber_id === a.sub.id && d.edition_date === a.editionDate)?.attempts ?? 0))) + 1;
        const failedNow = failAt === 1 || attempts >= MAX_ATTEMPTS;
        if (failedNow) run.failed += g.actions.length;
        say(`${g.key}: provider ${outcome.status} ${failedNow ? "(failed)" : `(attempt ${attempts} of ${MAX_ATTEMPTS}, will retry next hour)`} ${outcome.body.slice(0, 200)}`);
        await notify(env, failedNow ? "send-failed" : "send-retry", `Newsletter batch ${failedNow ? "failed" : "will retry"}: ${g.key}`, `Provider returned ${outcome.status}.\n${outcome.body}\n\nTick ${tick}, ${g.actions.length} reader(s).`);
      }
    }

    // 10. Once a day: never send a stale issue, tidy old rows, and warn before the provider's free tier runs out.
    if (now.getUTCHours() === 0) {
      const yesterday = ymd(addDays(todayIn("UTC", now), -1));
      const stale = await db.failStale(yesterday, nowIso);
      if (stale) { say(`${stale} stale reserved row(s) failed`); await notify(env, "stale", `${stale} newsletter row(s) went stale`, `Reserved deliveries for edition dates before ${yesterday} were never sent. Check send_runs for the failing ticks.`); }
      await db.housekeeping(nowIso);
      const active = await db.activeCount();
      if (active >= PROVIDER_SWAP_ALERT_AT) await notify(env, "provider-swap", `${active} active readers: time to move sending to SES`, `Resend's free tier is 100 emails a day. The plan is to swap the provider module to Amazon SES, not to pay for Resend Pro.`);
    }
    if (db.statementCount() > 30) await notify(env, "d1-budget", `Tick used ${db.statementCount()} D1 statements`, `The free plan allows 50 per invocation. Look at the grouping in src/newsletter/send.ts.`);
    say(`done: due ${run.due}, sent ${run.sent}, deferred ${run.deferred}, held ${run.held}, failed ${run.failed}, ${db.statementCount()} statements`);
    return finish(db);
  } catch (e) {
    say(`ERROR ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    await notify(env, "tick-error", "Newsletter tick threw", log.join("\n"));
    return finish(db);
  }
}
