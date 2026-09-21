/**
 * Every request under /newsletter and /admin/newsletter. src/index.ts only
 * dispatches here, so the shared router file stays small.
 *
 * Anonymous paths that cost money (a confirmation email) are guarded the way
 * note generation is after the 2026-09-20 crawler incident: Turnstile, a
 * per-IP rate limit, a per-address throttle, a suppression check, and a hard
 * daily cap on confirmation sends kept as a KV counter.
 */
import type { Env } from "../types";
import type { AdminNewsletterAction, NewsletterRoute } from "../router";
import { dafForDate, parseYmd, todayIn, ymd } from "../daf/schedule";
import { edgeGet, edgePut } from "../edgecache";
import { cachedResponse } from "../cache";
import { renderNotFound } from "../render/simple";
import { personalize, renderConfirmEmail, renderIssue, type RenderedIssue } from "../render/email";
import {
  CONSENT_VERSION, hourLabel, renderCheckInbox, renderConfirmedPage, renderExpired, renderGoodbye, renderNewsletterClosed,
  renderNewsletterPage, renderNotice, renderPrefsPage, renderPrivacyPage, renderUnsubPage, type FormState,
} from "../render/newsletterPages";
import { getNote } from "../note/store";
import { d1NewsletterDb, type Edition, type NewsletterDb, type Variant } from "./db";
import { buildEdition, runSendTick } from "./send";
import { issueHeaders, resendProvider } from "./resend";
import { emailHash, looksLikeEmail, normalizeEmail, randomHex, signConfirmToken, timingSafeEqual, verifyConfirmToken, CONFIRM_TOKEN_TTL_MS } from "./tokens";
import { TIMEZONES, isValidTimezone } from "./timezones";
import { applyResendEvent, verifySvix } from "./webhooks";
import { siteOrigin } from "./origin";

const HTML = { "content-type": "text/html; charset=utf-8" };
const JSON_H = { "content-type": "application/json; charset=utf-8" };
/** Confirmation emails per UTC day, whatever the traffic. Resend's free tier is 100 a day for everything. */
const CONFIRM_DAILY_CAP = 40;
const IP_LIMIT = 5;
const IP_WINDOW_S = 600;
const EMAIL_THROTTLE_S = 600;

export interface HandlerContext { origin: string; tz: string; today: Date; bypass: boolean; ck: (path: string) => string }

function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...HTML, ...extra } });
}
function noStore(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return html(body, status, { "cache-control": "no-store", ...extra });
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { ...JSON_H, "cache-control": "no-store" } });
}
function isPublic(env: Env): boolean {
  return env.NEWSLETTER_PUBLIC === "1";
}

export async function handleNewsletter(request: Request, env: Env, ctx: ExecutionContext, route: NewsletterRoute, x: HandlerContext): Promise<Response> {
  const origin = siteOrigin(env);
  const db = () => d1NewsletterDb(env.NEWSLETTER_DB);
  switch (route.kind) {
    case "newsletter": {
      if (request.method === "POST") return isPublic(env) ? subscribe(request, env, origin, db()) : new Response("not open", { status: 404 });
      if (!isPublic(env)) return cachedResponse(x.ck("/newsletter?closed"), 600, async () => html(renderNewsletterClosed(env, origin)), x.bypass);
      return cachedResponse(x.ck(`/newsletter?tz=${encodeURIComponent(x.tz)}`), 600, async () =>
        html(renderNewsletterPage(env, origin, { siteKey: env.TURNSTILE_SITE_KEY ?? "", tzOptions: TIMEZONES, defaultTz: x.tz })), x.bypass);
    }
    case "newsletter-confirm": return confirm(request, env, origin, db());
    case "newsletter-privacy": return cachedResponse(x.ck("/newsletter/privacy"), 3600, async () => html(renderPrivacyPage(env, origin)), x.bypass);
    case "newsletter-unsub": return unsubscribe(request, env, origin, db(), route.token);
    case "newsletter-prefs": return prefs(request, env, origin, db(), route.token);
    case "newsletter-issue": return issueArchive(env, origin, db(), route.ymd, x);
    case "newsletter-hook-resend": return resendHook(request, env, db());
    case "admin-newsletter": return admin(request, env, origin, db(), route.action, x);
  }
}

// ---------------- opt-in ----------------

function slotPrefs(slot: string | null): { hour: number; edition: Edition } {
  return slot === "evening" ? { hour: 20, edition: "tomorrow" } : { hour: 6, edition: "today" };
}

async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean> {
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch { return false; }
}

/** Per-IP limit: the Rate Limiting binding when bound, otherwise an edge-cache counter (per data centre, which is fine). */
async function ipAllowed(env: Env, ip: string): Promise<boolean> {
  if (env.SUBSCRIBE_RL) {
    try { return (await env.SUBSCRIBE_RL.limit({ key: ip })).success; } catch { /* fall through */ }
  }
  const key = `rl:sub:${ip}`;
  const n = (await edgeGet<number>(key)) ?? 0;
  if (n >= IP_LIMIT) return false;
  await edgePut(key, n + 1, IP_WINDOW_S);
  return true;
}

async function confirmationsAllowed(env: Env): Promise<boolean> {
  const key = `confirm:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await env.DAF_KV.get(key)) ?? 0);
  if (used >= CONFIRM_DAILY_CAP) return false;
  await env.DAF_KV.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  return true;
}

async function subscribe(request: Request, env: Env, origin: string, db: NewsletterDb): Promise<Response> {
  const form = await request.formData().catch(() => null);
  if (!form) return noStore(renderNotice(env, origin, "That did not work", ["The form did not arrive in one piece. <a href=\"/newsletter\">Try again.</a>"]), 400);
  const field = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : ""; };
  const state: FormState = { email: field("email").trim(), slot: field("slot") === "evening" ? "evening" : "morning", tz: field("tz"), hold: field("hold") === "1" };
  const again = (error: string, status = 400) => noStore(renderNewsletterPage(env, origin, { siteKey: env.TURNSTILE_SITE_KEY ?? "", tzOptions: TIMEZONES, defaultTz: state.tz || "America/New_York", state: { ...state, error } }), status);

  // Bots that fill the hidden field get the same friendly page and nothing is sent.
  if (field("website")) return noStore(renderCheckInbox(env, origin));
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await ipAllowed(env, ip))) return again("Too many attempts from this connection. Wait ten minutes and try again.", 429);

  const email = normalizeEmail(state.email ?? "");
  if (!looksLikeEmail(email)) return again("That does not look like an email address.");
  if (!isValidTimezone(state.tz ?? "")) return again("Pick a time zone from the list.");
  if (!env.TURNSTILE_SECRET_KEY || !env.TOKEN_HMAC_SECRET || !env.RESEND_API_KEY) {
    console.error("[newsletter] subscribe called without TURNSTILE_SECRET_KEY / TOKEN_HMAC_SECRET / RESEND_API_KEY");
    return noStore(renderNotice(env, origin, "Not quite ready", ["The sign-up form is missing a piece of its configuration. Write to me and I will add you by hand."]), 503);
  }
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, field("cf-turnstile-response"), ip))) return again("The bot check did not pass. Reload the page and try once more.");

  const hash = await emailHash(env.TOKEN_HMAC_SECRET, email);
  // Same page whether or not we send: nobody can learn from this form who subscribes.
  if (await edgeGet<number>(`sub:${hash}`)) return noStore(renderCheckInbox(env, origin));
  if (await db.isSuppressed(hash)) return noStore(renderCheckInbox(env, origin));
  if (!(await confirmationsAllowed(env))) { console.error("[newsletter] daily confirmation cap reached"); return noStore(renderCheckInbox(env, origin)); }
  await edgePut(`sub:${hash}`, 1, EMAIL_THROTTLE_S);

  const { hour, edition } = slotPrefs(state.slot ?? null);
  const token = await signConfirmToken(env.TOKEN_HMAC_SECRET, { email, tz: state.tz!, hour, edition, hold: state.hold ? 1 : 0, consent: field("consent") || CONSENT_VERSION, exp: Date.now() + CONFIRM_TOKEN_TTL_MS, nonce: randomHex(8) });
  const confirmUrl = `${origin}/newsletter/confirm?t=${encodeURIComponent(token)}`;
  const mail = renderConfirmEmail({ origin, siteName: env.SITE_NAME, confirmUrl, hourLabel: hourLabel(hour), tz: state.tz!, editionLabel: edition === "tomorrow" ? "tomorrow's daf the evening before" : "the day's daf" });
  const provider = resendProvider(env.RESEND_API_KEY);
  const from = env.NEWSLETTER_FROM ?? `Today's Daf <daf@news.${env.CANONICAL_HOST ?? "daf-yomi.dev"}>`;
  const out = await provider.sendOne({ from, to: email, subject: mail.subject, html: mail.html, text: mail.text, replyTo: env.NEWSLETTER_REPLY_TO, tag: "confirm" }, `confirm:${hash}:${new Date().toISOString().slice(0, 13)}`);
  if (!out.ok) console.error(`[newsletter] confirmation send failed ${out.status} ${out.body}`);
  return noStore(renderCheckInbox(env, origin));
}

async function confirm(request: Request, env: Env, origin: string, db: NewsletterDb): Promise<Response> {
  if (request.method !== "GET") return new Response("GET only", { status: 405 });
  const t = new URL(request.url).searchParams.get("t") ?? "";
  if (!env.TOKEN_HMAC_SECRET) return noStore(renderExpired(env, origin), 503);
  const p = await verifyConfirmToken(env.TOKEN_HMAC_SECRET, t);
  if (!p) return noStore(renderExpired(env, origin), 410);
  const hash = await emailHash(env.TOKEN_HMAC_SECRET, p.email);
  if (await db.isSuppressed(hash)) return noStore(renderNotice(env, origin, "One thing first", [`Mail to this address bounced or was reported as spam before, so I do not add it automatically. Write to me at <a href="mailto:joe@group17a.com">joe@group17a.com</a> and I will sort it out.`]), 409);
  const now = new Date().toISOString();
  const sub = await db.upsertConfirmed({ email: p.email, email_hash: hash, tz: p.tz, hour: p.hour, edition: p.edition, hold_shabbat: p.hold, consent_version: p.consent, unsub_token: randomHex(24) }, now);
  return noStore(renderConfirmedPage(env, origin, sub));
}

// ---------------- readers ----------------

async function unsubscribe(request: Request, env: Env, origin: string, db: NewsletterDb, token: string): Promise<Response> {
  if (request.method === "GET" || request.method === "HEAD") {
    const sub = await db.findByToken(token);
    return noStore(renderUnsubPage(env, origin, token, sub));
  }
  if (request.method !== "POST") return new Response("GET or POST", { status: 405 });
  // Both the page's button and RFC 8058 one-click (body "List-Unsubscribe=One-Click") land here; both are idempotent 200s.
  const before = await db.unsubscribe(token, new Date().toISOString());
  return noStore(renderGoodbye(env, origin, before));
}

async function prefs(request: Request, env: Env, origin: string, db: NewsletterDb, token: string): Promise<Response> {
  const sub = await db.findByToken(token);
  if (!sub || sub.status !== "active") return noStore(renderNotice(env, origin, "Nothing to change", [`This link does not belong to an active subscription. <a href="/newsletter">Subscribe again</a> if you would like the daf back.`]), 404);
  if (request.method === "GET" || request.method === "HEAD") return noStore(renderPrefsPage(env, origin, sub, TIMEZONES));
  if (request.method !== "POST") return new Response("GET or POST", { status: 405 });
  const form = await request.formData().catch(() => null);
  const field = (k: string) => { const v = form?.get(k); return typeof v === "string" ? v : ""; };
  const hour = Number(field("hour"));
  const edition: Edition = field("edition") === "tomorrow" ? "tomorrow" : "today";
  const tz = field("tz");
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return noStore(renderPrefsPage(env, origin, sub, TIMEZONES, { error: "Pick an hour from the list." }), 400);
  if (!isValidTimezone(tz)) return noStore(renderPrefsPage(env, origin, sub, TIMEZONES, { error: "Pick a time zone from the list." }), 400);
  await db.updatePrefs(token, { tz, hour, edition, hold_shabbat: field("hold") === "1" ? 1 : 0 }, new Date().toISOString());
  const updated = (await db.findByToken(token)) ?? sub;
  return noStore(renderPrefsPage(env, origin, updated, TIMEZONES, { saved: true }));
}

async function issueArchive(env: Env, origin: string, db: NewsletterDb, date: string, x: HandlerContext): Promise<Response> {
  if (!parseYmd(date)) return html(renderNotFound(env, origin, `/newsletter/issue/${date}`), 404);
  return cachedResponse(x.ck(`/newsletter/issue/${date}`), 3600, async () => {
    const editions = await db.editionsFor([date]);
    const e = editions.find((r) => r.variant === "full") ?? editions[0];
    if (!e) return html(renderNotFound(env, origin, `/newsletter/issue/${date}`), 404);
    const shown = personalize({ subject: e.subject, preheader: e.preheader, html: e.html, text: e.text }, { unsubUrl: `${origin}/newsletter`, prefsUrl: `${origin}/newsletter`, email: "you", confirmedDate: "the day you signed up", heldHtml: "", heldText: "" });
    return html(shown.html, 200, { "x-robots-tag": "noindex" });
  }, x.bypass);
}

// ---------------- provider webhook ----------------

async function resendHook(request: Request, env: Env, db: NewsletterDb): Promise<Response> {
  if (request.method !== "POST") return new Response("POST only", { status: 405 });
  if (!env.RESEND_WEBHOOK_SECRET || !env.TOKEN_HMAC_SECRET) return new Response("webhook not configured", { status: 503 });
  const body = await request.text();
  const ok = await verifySvix(env.RESEND_WEBHOOK_SECRET, { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") }, body);
  if (!ok) return new Response("bad signature", { status: 401 });
  let ev: { type?: string };
  try { ev = JSON.parse(body) as { type?: string }; } catch { return new Response("bad json", { status: 400 }); }
  if (!ev.type) return new Response("bad event", { status: 400 });
  const outcome = await applyResendEvent(db, env.TOKEN_HMAC_SECRET, request.headers.get("svix-id")!, ev as Parameters<typeof applyResendEvent>[3], new Date().toISOString());
  console.log(`[newsletter] webhook ${ev.type}: ${outcome}`);
  return json({ ok: true, outcome });
}

// ---------------- admin ----------------

async function authorized(request: Request, env: Env): Promise<boolean> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(env.ADMIN_TOKEN) && (await timingSafeEqual(token, env.ADMIN_TOKEN!));
}

async function admin(request: Request, env: Env, origin: string, db: NewsletterDb, action: AdminNewsletterAction, x: HandlerContext): Promise<Response> {
  if (!(await authorized(request, env))) return new Response("unauthorized", { status: 401 });
  const url = new URL(request.url);
  switch (action) {
    case "status": {
      const dates = [-1, 0, 1].map((k) => ymd(new Date(x.today.getFullYear(), x.today.getMonth(), x.today.getDate() + k)));
      const [byStatus, runs, deliveries, editions] = await Promise.all([db.countByStatus(), db.recentRuns(24), db.deliveryCounts(dates), db.editionsFor(dates)]);
      return json({ subscribers: byStatus, recentRuns: runs, deliveries, editions: editions.map((e) => ({ edition_date: e.edition_date, variant: e.variant, slug: e.slug, daf: e.daf, subject: e.subject, bytes: e.html.length, rendered_at: e.rendered_at })) });
    }
    case "send": {
      if (request.method !== "POST") return new Response("POST only", { status: 405 });
      const date = parseYmd(url.searchParams.get("date") ?? "") ?? todayIn(x.tz);
      const variant: Variant = url.searchParams.get("variant") === "nonote" ? "nonote" : "full";
      const ref = dafForDate(date);
      const note = variant === "full" ? await getNote(env.DAF_KV, ref.tractate, ref.daf) : null;
      const edition = buildEdition(env, ymd(date), note ? variant : "nonote", note, new Date());
      const token = "0".repeat(48);
      const shown: RenderedIssue = personalize({ subject: edition.subject, preheader: edition.preheader, html: edition.html, text: edition.text }, {
        unsubUrl: `${origin}/newsletter/u/${token}`, prefsUrl: `${origin}/newsletter/prefs/${token}`, email: url.searchParams.get("to") ?? "you", confirmedDate: "today", heldHtml: "", heldText: "",
      });
      if (url.searchParams.has("dry")) return html(url.searchParams.get("format") === "text" ? `<pre>${shown.text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>` : shown.html, 200, { "cache-control": "no-store", "x-subject": encodeURIComponent(shown.subject) });
      const to = url.searchParams.get("to");
      if (!to || !looksLikeEmail(to)) return json({ error: "need ?to=<address> (or &dry=1)" }, 400);
      if (!env.RESEND_API_KEY) return json({ error: "RESEND_API_KEY unset" }, 503);
      const from = env.NEWSLETTER_FROM ?? `Today's Daf <daf@news.${env.CANONICAL_HOST ?? "daf-yomi.dev"}>`;
      const out = await resendProvider(env.RESEND_API_KEY).sendOne({ from, to, subject: shown.subject, html: shown.html, text: shown.text, replyTo: env.NEWSLETTER_REPLY_TO, headers: issueHeaders(origin, token, env.CANONICAL_HOST ?? "daf-yomi.dev"), tag: `test-${edition.edition_date}` });
      return json({ sent: out.ok, to, subject: shown.subject, bytes: shown.html.length, ...out }, out.ok ? 200 : 502);
    }
    case "tick": {
      if (request.method !== "POST") return new Response("POST only", { status: 405 });
      const time = Number(url.searchParams.get("time") ?? Date.now());
      const run = await runSendTick(env, Number.isFinite(time) ? time : Date.now());
      return json(run);
    }
    case "subscribe": {
      // Add a reader by hand (before the public form opens, or for someone who wrote in). Same path as a confirmed
      // sign-up, so the address hash and the unsubscribe token are right.
      if (request.method !== "POST") return new Response("POST only", { status: 405 });
      if (!env.TOKEN_HMAC_SECRET) return json({ error: "TOKEN_HMAC_SECRET unset" }, 503);
      const email = normalizeEmail(url.searchParams.get("email") ?? "");
      const tz = url.searchParams.get("tz") ?? env.DEFAULT_TIMEZONE;
      const hour = Number(url.searchParams.get("hour") ?? 6);
      const edition: Edition = url.searchParams.get("edition") === "tomorrow" ? "tomorrow" : "today";
      const hold: 0 | 1 = url.searchParams.get("hold") === "1" ? 1 : 0;
      if (!looksLikeEmail(email)) return json({ error: "need ?email=" }, 400);
      if (!isValidTimezone(tz)) return json({ error: `bad tz ${tz}` }, 400);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) return json({ error: "hour must be 0-23" }, 400);
      const hash = await emailHash(env.TOKEN_HMAC_SECRET, email);
      const sub = await db.upsertConfirmed({ email, email_hash: hash, tz, hour, edition, hold_shabbat: hold, consent_version: "admin", unsub_token: randomHex(24) }, new Date().toISOString());
      return json({ id: sub.id, email: sub.email, tz: sub.tz, hour: sub.hour, edition: sub.edition, hold_shabbat: sub.hold_shabbat, status: sub.status, prefs: `${origin}/newsletter/prefs/${sub.unsub_token}` });
    }
    case "rebuild-edition": {
      if (request.method !== "POST") return new Response("POST only", { status: 405 });
      const date = url.searchParams.get("date") ?? "";
      if (!parseYmd(date)) return json({ error: "need ?date=YYYY-MM-DD" }, 400);
      const n = await db.deleteEditions(date);
      return json({ deleted: n, date });
    }
  }
  return json({ error: "unknown action" }, 404);
}
