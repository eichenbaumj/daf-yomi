import type { Env } from "./types";
import { parseRoute, type Route } from "./router";
import { TRACTATES, dafPath, dafLabel, isValidDaf, tractateBySlug, type Tractate } from "./daf/tractates";
import { addDays, dafForDate, dateForDaf, hebrewDate, parseYmd, todayIn, ymd, type DafRef } from "./daf/schedule";
import { positionFor } from "./daf/position";
import { SefariaError, fetchText, loadDafSections, type DafSection } from "./sefaria/client";
import { getNote, notedDafim, type DafNote } from "./note/store";
import { ensureNote } from "./note/generate";
import { buildTranslateInput, checkTranslation, ensureTranslation, hashTranslatePrompt, type TranslatableLang } from "./note/translate";
import { currentTranslation, getTranslation, putTranslation, type TranslatedNote } from "./note/tstore";
import { ENABLED_LANGS, isLang, p, type Lang } from "./i18n/strings";
import { renderDafPage } from "./render/dafPage";
import { renderTractatePage, tractateIntroRef } from "./render/tractatePage";
import { renderTractatesIndex } from "./render/tractatesIndex";
import { renderAbout } from "./render/about";
import { renderFeed, type FeedItem } from "./render/feed";
import { isPublicLang } from "./render/layout";
import { renderError, renderNotFound } from "./render/simple";
import { cachedResponse } from "./cache";
import { runCron } from "./cron";
import { handleNewsletter } from "./newsletter/http";
import { SEND_CRON, runSendTick } from "./newsletter/send";

const HTML = { "content-type": "text/html; charset=utf-8" };
/** On-visit note generation happens only within this many days of today. */
const HEAL_WINDOW_DAYS = 3;
const JSON_H = { "content-type": "application/json; charset=utf-8" };
/** The language cookie: set by /lang/<x>, read only by "/" (every other path says its language in the URL). */
const LANG_COOKIE = "daf_lang";

function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...HTML, ...extra } });
}
function redirect(to: string, status: 301 | 302 | 308 = 302, extra: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { location: to, ...extra } });
}

function visitorTimezone(request: Request, env: Env): string {
  const q = new URL(request.url).searchParams.get("tz");
  const cf = (request as Request & { cf?: { timezone?: string } }).cf?.timezone;
  for (const tz of [q, cf, env.DEFAULT_TIMEZONE]) {
    if (!tz) continue;
    try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return tz; } catch { /* next */ }
  }
  return "UTC";
}

function cookieLang(request: Request): Lang | null {
  const m = new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=([a-z]{2})`).exec(request.headers.get("cookie") ?? "");
  return m && isLang(m[1]!) ? (m[1] as Lang) : null;
}

/** The page's language from a parsed route; English for everything without a prefix. */
function langOf(route: Route): Lang {
  return "lang" in route && route.lang ? route.lang : "en";
}

async function loadDafTexts(ref: DafRef, kv: KVNamespace, lang: Lang): Promise<DafSection[]> {
  return loadDafSections(ref.tractate, ref.daf, ref.cycle, kv, { withBiur: lang !== "en" });
}

async function dafPageResponse(env: Env, ctx: ExecutionContext, origin: string, lang: Lang, ref: DafRef, date: Date, isToday: boolean, todayRef: DafRef, todayDate: Date): Promise<Response> {
  const [texts, note, translation] = await Promise.all([
    loadDafTexts(ref, env.DAF_KV, lang),
    getNote(env.DAF_KV, ref.tractate, ref.daf),
    lang === "en" ? Promise.resolve<TranslatedNote | null>(null) : getTranslation(env.DAF_KV, lang, ref.tractate, ref.daf),
  ]);
  const notesEnabled = Boolean(env.ANTHROPIC_API_KEY);
  // Self-heal only for pages a person would plausibly be reading now (yesterday, today, tomorrow, a few days
  // either side). A crawler walking the sitemap's 2,711 permalinks must never trigger paid generation:
  // on 2026-09-20 one did, and generated ~2,600 notes in a day. Older pages say "not written yet" instead.
  // Translations never self-heal: the cron makes them for the near days, scripts/translate.ts for the rest.
  const daysFromToday = Math.round((date.getTime() - todayDate.getTime()) / 86400000);
  const nearToday = Math.abs(daysFromToday) <= HEAL_WINDOW_DAYS;
  if (!note && notesEnabled && nearToday) {
    ctx.waitUntil(ensureNote(env, ref).then((o) => console.log(`[heal] ${ref.tractate.name} ${ref.daf}: ${o.status}${"reason" in o ? ` ${o.reason}` : ""}`)).catch((e) => console.error("[heal]", e)));
  }
  const body = renderDafPage({ env, origin, lang, ref, date, isToday, texts, note, translation, notesEnabled, todayRef, todayDate });
  const shown = lang === "en" ? note : currentTranslation(note, translation);
  return html(body, 200, { "x-daf": `${ref.tractate.slug}/${ref.daf}`, "x-daf-note": shown ? "yes" : "pending" });
}

function apiPayload(ref: DafRef, date: Date, note: DafNote | null, origin: string) {
  const p = positionFor(ref);
  return {
    date: ymd(date),
    hebrewDate: hebrewDate(date),
    tractate: { name: ref.tractate.name, he: ref.tractate.heTitle, slug: ref.tractate.slug, seder: ref.tractate.seder },
    daf: ref.daf,
    label: dafLabel(ref.tractate, ref.daf),
    url: `${origin}${dafPath(ref.tractate, ref.daf)}`,
    position: { chapter: p.chapterLabel, dafOfTractate: p.dafOfTractate, dayInCycle: p.dayInCycle, cycleLength: p.cycleLength, cycle: p.cycle, cycleEnds: ymd(p.cycleEnd) },
    note: note ? { summary: note.summary, question: note.question, writtenBy: "Claude (AI), from the English text only", model: note.model, generatedAt: note.generatedAt } : null,
    text: ref.tractate.refMode === "talmud"
      ? { source: "Sefaria", license: "CC BY-NC 4.0 (William Davidson Talmud)", sefaria: `https://www.sefaria.org/${ref.tractate.sefariaTitle.replace(/ /g, "_")}.${ref.daf}a` }
      : { source: "Sefaria", license: "see the page; not the Davidson Talmud for this day", sefaria: `https://www.sefaria.org/${ref.tractate.sefariaTitle.replace(/ /g, "_")}` },
  };
}

/**
 * GET /lang/<x>?to=<path>: remember the language in a cookie and go to that page in it. `to` is never echoed: it is
 * parsed with the router and the destination rebuilt from the parsed route, so "//evil.com" and friends go home.
 */
function switchLanguage(url: URL, lang: Lang): Response {
  const raw = url.searchParams.get("to") ?? "/";
  const stripped = raw.replace(/^\/(he|yi)(?=\/|$)/, "") || "/";
  const r = parseRoute(stripped);
  let dest = "/";
  if (r.kind === "daf") dest = dafPath(r.tractate, r.daf);
  else if (r.kind === "tractate") dest = `/${r.tractate.slug}`;
  else if (r.kind === "tractates" || r.kind === "about") dest = `/${r.kind}`;
  const secure = url.protocol === "https:" ? "; Secure" : "";
  const cookie = lang === "en"
    ? `${LANG_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${secure}`
    : `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${secure}`;
  return redirect(p(lang, dest), 302, { "set-cookie": cookie, "cache-control": "no-store" });
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const route = parseRoute(url.pathname);
  const lang = langOf(route);
  const bypass = url.searchParams.has("nocache");
  // Cache keys carry the build id and the language, so a deploy never serves last version's HTML and a Hebrew
  // page never serves an English one. Nothing else may vary a cached body (there is no Vary header).
  const ck = (path: string) => `${origin}/_c/${env.BUILD ?? "dev"}${lang === "en" ? "" : `/${lang}`}${path}`;
  const tz = visitorTimezone(request, env);
  const today = todayIn(tz);

  switch (route.kind) {
    case "redirect": return redirect(route.to, 301);
    case "not-found": return html(renderNotFound(env, origin, url.pathname, lang), 404);
    case "lang": return switchLanguage(url, route.lang);
    case "robots": return new Response(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /lang/\nDisallow: /newsletter/u/\nDisallow: /newsletter/prefs/\nDisallow: /newsletter/confirm\nDisallow: /newsletter/hooks/\nSitemap: ${origin}/sitemap.xml\n`, { headers: { "content-type": "text/plain" } });
    case "relative": {
      const ref = dafForDate(addDays(today, route.offset));
      return redirect(p(lang, dafPath(ref.tractate, ref.daf)));
    }
    case "date": {
      const d = parseYmd(route.ymd);
      if (!d) return html(renderNotFound(env, origin, url.pathname, lang), 404);
      try {
        const ref = dafForDate(d);
        return redirect(p(lang, dafPath(ref.tractate, ref.daf)));
      } catch { return html(renderNotFound(env, origin, url.pathname, lang), 404); }
    }
    case "today": {
      // The one place the cookie is read, before the cache: a reader who chose Hebrew lands on /he.
      if (lang === "en") {
        const chosen = cookieLang(request);
        if (chosen && chosen !== "en") return redirect(p(chosen, "/"), 302, { "cache-control": "no-store" });
      }
      const ref = dafForDate(today);
      return cachedResponse(ck(`/today/${ref.tractate.slug}/${ref.daf}`), 600, () => dafPageResponse(env, ctx, origin, lang, ref, today, true, ref, today), bypass);
    }
    case "daf": {
      const todayRef = dafForDate(today);
      const cycle = todayRef.cycle;
      const date = dateForDaf(route.tractate, route.daf, cycle);
      const ref: DafRef = { tractate: route.tractate, daf: route.daf, cycle, dayInCycle: Math.round((date.getTime() - dateForDaf(TRACTATES[0]!, TRACTATES[0]!.firstDaf, cycle).getTime()) / 86400000) + 1 };
      const isToday = ymd(date) === ymd(today);
      // Pages without a note (or, in a translated language, without a current translation) are cached briefly.
      const ttl = (res: Response) => (isToday ? 600 : res.headers.get("x-daf-note") === "yes" ? 3600 : 120);
      return cachedResponse(ck(`${dafPath(ref.tractate, ref.daf)}?t=${isToday ? "today" : "perma"}&d=${ymd(today)}`), ttl, () => dafPageResponse(env, ctx, origin, lang, ref, date, isToday, todayRef, today), bypass);
    }
    case "tractate": {
      const todayRef = dafForDate(today);
      return cachedResponse(ck(`/${route.tractate.slug}?d=${ymd(today)}`), 1800, async () => {
        const [noted, intro] = await Promise.all([
          notedDafim(env.DAF_KV, route.tractate),
          (async () => { const r = tractateIntroRef(route.tractate); if (!r) return null; try { return await fetchText(r, env.DAF_KV); } catch { return null; } })(),
        ]);
        return html(renderTractatePage({ env, origin, lang, tractate: route.tractate, today: todayRef, todayDate: today, noted, intro }));
      }, bypass);
    }
    case "tractates": {
      const todayRef = dafForDate(today);
      return cachedResponse(ck(`/tractates?d=${ymd(today)}`), 3600, async () => html(renderTractatesIndex(env, origin, todayRef, today, lang)), bypass);
    }
    case "about": {
      const todayRef = dafForDate(today);
      return cachedResponse(ck(`/about?d=${ymd(today)}`), 3600, async () => html(renderAbout(env, origin, todayRef, lang)), bypass);
    }
    case "feed": {
      const utcToday = todayIn("UTC");
      return cachedResponse(ck(`/feed.xml?d=${ymd(utcToday)}`), 1800, async () => {
        const items: FeedItem[] = [];
        for (let i = 0; i < 14; i++) {
          const d = addDays(utcToday, -i);
          const ref = dafForDate(d);
          const note = await getNote(env.DAF_KV, ref.tractate, ref.daf);
          const translation = lang === "en" || !note ? null : await getTranslation(env.DAF_KV, lang, ref.tractate, ref.daf);
          items.push({ date: d, ref, note, translation });
        }
        return new Response(renderFeed(env, origin, items, lang), { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
      }, bypass);
    }
    case "sitemap": {
      return cachedResponse(ck("/sitemap.xml"), 86400, async () => {
        // Languages appear only once public; until then a Hebrew page is noindex and unlisted.
        const langs = ENABLED_LANGS.filter((l) => isPublicLang(env, l));
        const paths: string[] = ["/", "/about", "/tractates"];
        for (const t of TRACTATES) {
          paths.push(`/${t.slug}`);
          for (let d = t.firstDaf; d <= t.lastDaf; d++) paths.push(dafPath(t, d));
        }
        const alt = (path: string) => langs.length > 1
          ? langs.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${origin}${p(l, path)}"/>`).join("") + `<xhtml:link rel="alternate" hreflang="x-default" href="${origin}${path}"/>`
          : "";
        const urls: string[] = [];
        for (const path of paths) for (const l of langs) urls.push(`<url><loc>${origin}${p(l, path)}</loc>${alt(path)}</url>`);
        urls.push(`<url><loc>${origin}/newsletter</loc></url>`);
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
        return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8" } });
      }, bypass);
    }
    case "api-today": {
      const ref = dafForDate(today);
      const note = await getNote(env.DAF_KV, ref.tractate, ref.daf);
      return new Response(JSON.stringify({ timezone: tz, ...apiPayload(ref, today, note, origin) }, null, 2), { headers: { ...JSON_H, "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
    }
    case "api-daf": {
      const cycle = dafForDate(today).cycle;
      const date = dateForDaf(route.tractate, route.daf, cycle);
      const ref = dafForDate(date);
      const note = await getNote(env.DAF_KV, ref.tractate, ref.daf);
      return new Response(JSON.stringify(apiPayload(ref, date, note, origin), null, 2), { headers: { ...JSON_H, "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } });
    }
    case "admin-bake": return adminBake(request, env, today);
    case "admin-translate": return adminTranslate(request, env, today, route.action);
    case "newsletter":
    case "newsletter-confirm":
    case "newsletter-privacy":
    case "newsletter-unsub":
    case "newsletter-prefs":
    case "newsletter-issue":
    case "newsletter-hook-resend":
    case "admin-newsletter":
      return handleNewsletter(request, env, ctx, route, { origin, tz, today, bypass, ck });
  }
}

function authorized(request: Request, env: Env): boolean {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(env.ADMIN_TOKEN) && token === env.ADMIN_TOKEN;
}

/** ?slug=&daf= or ?date=YYYY-MM-DD → the daf, in the current cycle. */
function refFromParams(url: URL, today: Date): DafRef | Response {
  const dateParam = url.searchParams.get("date");
  if (dateParam) {
    const d = parseYmd(dateParam);
    if (!d) return new Response("bad date", { status: 400 });
    return dafForDate(d);
  }
  const t: Tractate | undefined = tractateBySlug(url.searchParams.get("slug") ?? "");
  const daf = Number(url.searchParams.get("daf"));
  if (!t || !isValidDaf(t, daf)) return new Response("bad slug/daf", { status: 400 });
  const cycle = dafForDate(today).cycle;
  return dafForDate(dateForDaf(t, daf, cycle));
}

/**
 * POST /admin/bake?slug=bekhorot&daf=2[&force=1]  or  ?date=YYYY-MM-DD
 * Header: authorization: Bearer <ADMIN_TOKEN>. Used by scripts/backfill.ts and for re-bakes after a style change.
 */
async function adminBake(request: Request, env: Env, today: Date): Promise<Response> {
  if (request.method !== "POST") return new Response("POST only", { status: 405 });
  if (!authorized(request, env)) return new Response("unauthorized", { status: 401 });
  const ref = refFromParams(new URL(request.url), today);
  if (ref instanceof Response) return ref;
  const outcome = await ensureNote(env, ref, { force: new URL(request.url).searchParams.has("force"), skipLock: true });
  return new Response(JSON.stringify({ daf: `${ref.tractate.slug}/${ref.daf}`, ...outcome }, null, 2), { status: outcome.status === "failed" ? 502 : 200, headers: JSON_H });
}

/**
 * The translation endpoints (all Bearer <ADMIN_TOKEN>):
 *   POST /admin/translate?slug=&daf=&lang=he[&force=1]   translate here, one call, and store
 *   GET  /admin/note?slug=&daf=[&lang=he]                the stored English note (and that language's translation)
 *   POST /admin/translate/put  {lang, slug, daf, summary, question, quotes, of, model, promptVersion, usage?}
 *        store a translation made offline (scripts/translate.ts via the Batch API); it is checked here again and
 *        refused unless `of` is the stored English note's generatedAt.
 */
async function adminTranslate(request: Request, env: Env, today: Date, action: "run" | "put" | "note"): Promise<Response> {
  if (!authorized(request, env)) return new Response("unauthorized", { status: 401 });
  const url = new URL(request.url);
  const langParam = url.searchParams.get("lang") ?? "he";
  if (action === "note") {
    if (request.method !== "GET") return new Response("GET only", { status: 405 });
    const ref = refFromParams(url, today);
    if (ref instanceof Response) return ref;
    const note = await getNote(env.DAF_KV, ref.tractate, ref.daf);
    const translation = note && isLang(langParam) && langParam !== "en" ? await getTranslation(env.DAF_KV, langParam, ref.tractate, ref.daf) : null;
    return new Response(JSON.stringify({ daf: `${ref.tractate.slug}/${ref.daf}`, note, translation, current: note && translation ? translation.of === note.generatedAt && translation.promptVersion === hashTranslatePrompt(langParam as TranslatableLang) : false }, null, 2), { headers: JSON_H });
  }
  if (request.method !== "POST") return new Response("POST only", { status: 405 });
  if (action === "run") {
    if (!isLang(langParam) || langParam === "en") return new Response("bad lang", { status: 400 });
    const ref = refFromParams(url, today);
    if (ref instanceof Response) return ref;
    const outcome = await ensureTranslation(env, ref, langParam, { force: url.searchParams.has("force") });
    return new Response(JSON.stringify({ daf: `${ref.tractate.slug}/${ref.daf}`, lang: langParam, ...outcome }, null, 2), { status: outcome.status === "failed" ? 502 : 200, headers: JSON_H });
  }
  // put
  let body: any;
  try { body = await request.json(); } catch { return new Response("bad json", { status: 400 }); }
  const lang = String(body?.lang ?? "");
  if (!isLang(lang) || lang === "en") return new Response("bad lang", { status: 400 });
  const t = tractateBySlug(String(body?.slug ?? ""));
  const daf = Number(body?.daf);
  if (!t || !isValidDaf(t, daf)) return new Response("bad slug/daf", { status: 400 });
  const draft = { summary: String(body?.summary ?? ""), question: String(body?.question ?? ""), quotes: Array.isArray(body?.quotes) ? body.quotes.map(String) : [] };
  const note = await getNote(env.DAF_KV, t, daf);
  if (!note) return new Response(JSON.stringify({ status: "refused", reason: "no English note" }), { status: 409, headers: JSON_H });
  if (String(body?.of ?? "") !== note.generatedAt) return new Response(JSON.stringify({ status: "refused", reason: `stale: translation is of ${body?.of}, note is ${note.generatedAt}` }), { status: 409, headers: JSON_H });
  const ref = dafForDate(dateForDaf(t, daf, dafForDate(today).cycle));
  const { heSource } = await buildTranslateInput(ref, lang, note, env.DAF_KV);
  const check = checkTranslation(draft, heSource, note);
  if (!check.ok) return new Response(JSON.stringify({ status: "rejected", problems: check.problems }), { status: 422, headers: JSON_H });
  const translation: TranslatedNote = {
    ...draft, of: note.generatedAt, sourcePromptVersion: note.promptVersion,
    model: String(body?.model ?? env.NOTE_MODEL ?? "claude-opus-5"),
    promptVersion: String(body?.promptVersion ?? hashTranslatePrompt(lang)),
    generatedAt: new Date().toISOString(),
    usage: body?.usage && typeof body.usage === "object" ? { inputTokens: Number(body.usage.inputTokens ?? 0), outputTokens: Number(body.usage.outputTokens ?? 0), attempts: Number(body.usage.attempts ?? 1), estUsd: Number(body.usage.estUsd ?? 0) } : undefined,
  };
  await putTranslation(env.DAF_KV, lang, t, daf, translation);
  return new Response(JSON.stringify({ status: "stored", daf: `${t.slug}/${daf}`, lang }, null, 2), { headers: JSON_H });
}

/** Hosts that must never be redirected to the canonical domain (local dev). */
function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (env.CANONICAL_HOST && url.hostname !== env.CANONICAL_HOST && !isLocalHost(url.hostname)) {
      // The old workers.dev URL and www keep working as permanent redirects, so shared links never break.
      // A 308 keeps a form POST a POST (a 301 would turn it into a GET on the way to the canonical host).
      return redirect(`https://${env.CANONICAL_HOST}${url.pathname}${url.search}`, request.method === "GET" || request.method === "HEAD" ? 301 : 308);
    }
    const origin = url.origin;
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      console.error(e);
      const msg = e instanceof SefariaError ? e.message : "Something went wrong on our side.";
      const m = /^\/([a-z]{2})(?:\/|$)/.exec(url.pathname.toLowerCase());
      const lang: Lang = m && isLang(m[1]!) ? (m[1] as Lang) : "en";
      return html(renderError(env, origin, msg, lang), e instanceof SefariaError ? 502 : 500, { "cache-control": "no-store" });
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Three triggers share this Worker. The hourly one sends the newsletter; anything else runs the bake,
    // so a mistyped cron string degrades to "bake twice", never to "never send".
    const cron = (controller.cron ?? "").trim().replace(/\s+/g, " ");
    const job = cron === SEND_CRON
      ? runSendTick(env, controller.scheduledTime).catch((e) => console.error("[tick]", e))
      : runCron(env, controller.scheduledTime).catch((e) => console.error("[cron]", e));
    ctx.waitUntil(job);
  },
};
