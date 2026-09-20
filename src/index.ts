import type { Env } from "./types";
import { parseRoute } from "./router";
import { TRACTATES, dafPath, dafLabel, isValidDaf, type Tractate } from "./daf/tractates";
import { addDays, dafForDate, dateForDaf, hebrewDate, parseYmd, todayIn, ymd, type DafRef } from "./daf/schedule";
import { positionFor } from "./daf/position";
import { SefariaError, fetchText, resolveDafRefs, type SefariaText } from "./sefaria/client";
import { getNote, notedDafim, type DafNote } from "./note/store";
import { ensureNote } from "./note/generate";
import { renderDafPage } from "./render/dafPage";
import { renderTractatePage, tractateIntroRef } from "./render/tractatePage";
import { renderTractatesIndex } from "./render/tractatesIndex";
import { renderAbout } from "./render/about";
import { renderFeed, type FeedItem } from "./render/feed";
import { renderError, renderNotFound } from "./render/simple";
import { cachedResponse } from "./cache";
import { runCron } from "./cron";

const HTML = { "content-type": "text/html; charset=utf-8" };
/** On-visit note generation happens only within this many days of today. */
const HEAL_WINDOW_DAYS = 3;
const JSON_H = { "content-type": "application/json; charset=utf-8" };

function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...HTML, ...extra } });
}
function redirect(to: string, status: 301 | 302 = 302): Response {
  return new Response(null, { status, headers: { location: to } });
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

async function loadDafTexts(ref: DafRef, kv: KVNamespace): Promise<{ label: string; text: SefariaText }[]> {
  const resolved = await resolveDafRefs(ref.tractate, ref.daf, ref.cycle, kv);
  const out: { label: string; text: SefariaText }[] = [];
  for (let i = 0; i < resolved.urlRefs.length; i++) {
    out.push({ label: resolved.labels[i] ?? resolved.urlRefs[i]!, text: await fetchText(resolved.urlRefs[i]!, kv) });
  }
  return out;
}

async function dafPageResponse(env: Env, ctx: ExecutionContext, origin: string, ref: DafRef, date: Date, isToday: boolean, todayRef: DafRef, todayDate: Date): Promise<Response> {
  const [texts, note] = await Promise.all([loadDafTexts(ref, env.DAF_KV), getNote(env.DAF_KV, ref.tractate, ref.daf)]);
  const notesEnabled = Boolean(env.ANTHROPIC_API_KEY);
  // Self-heal only for pages a person would plausibly be reading now (yesterday, today, tomorrow, a few days
  // either side). A crawler walking the sitemap's 2,711 permalinks must never trigger paid generation:
  // on 2026-09-20 one did, and generated ~2,600 notes in a day. Older pages say "not written yet" instead.
  const daysFromToday = Math.round((date.getTime() - todayDate.getTime()) / 86400000);
  const nearToday = Math.abs(daysFromToday) <= HEAL_WINDOW_DAYS;
  if (!note && notesEnabled && nearToday) {
    ctx.waitUntil(ensureNote(env, ref).then((o) => console.log(`[heal] ${ref.tractate.name} ${ref.daf}: ${o.status}${"reason" in o ? ` ${o.reason}` : ""}`)).catch((e) => console.error("[heal]", e)));
  }
  const body = renderDafPage({ env, origin, ref, date, isToday, texts, note, notesEnabled, todayRef });
  return html(body, 200, { "x-daf": `${ref.tractate.slug}/${ref.daf}`, "x-daf-note": note ? "yes" : "pending" });
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

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const route = parseRoute(url.pathname);
  const bypass = url.searchParams.has("nocache");
  // Cache keys carry the build id so a deploy never serves last version's HTML.
  const ck = (path: string) => `${origin}/_c/${env.BUILD ?? "dev"}${path}`;
  const tz = visitorTimezone(request, env);
  const today = todayIn(tz);

  switch (route.kind) {
    case "redirect": return redirect(route.to, 301);
    case "not-found": return html(renderNotFound(env, origin, url.pathname), 404);
    case "robots": return new Response(`User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${origin}/sitemap.xml\n`, { headers: { "content-type": "text/plain" } });
    case "relative": {
      const ref = dafForDate(addDays(today, route.offset));
      return redirect(dafPath(ref.tractate, ref.daf));
    }
    case "date": {
      const d = parseYmd(route.ymd);
      if (!d) return html(renderNotFound(env, origin, url.pathname), 404);
      try {
        const ref = dafForDate(d);
        return redirect(dafPath(ref.tractate, ref.daf));
      } catch { return html(renderNotFound(env, origin, url.pathname), 404); }
    }
    case "today": {
      const ref = dafForDate(today);
      return cachedResponse(ck(`/today/${ref.tractate.slug}/${ref.daf}`), 600, () => dafPageResponse(env, ctx, origin, ref, today, true, ref, today), bypass);
    }
    case "daf": {
      const todayRef = dafForDate(today);
      const cycle = todayRef.cycle;
      const date = dateForDaf(route.tractate, route.daf, cycle);
      const ref: DafRef = { tractate: route.tractate, daf: route.daf, cycle, dayInCycle: Math.round((date.getTime() - dateForDaf(TRACTATES[0]!, TRACTATES[0]!.firstDaf, cycle).getTime()) / 86400000) + 1 };
      const isToday = ymd(date) === ymd(today);
      // Pages without a note yet are cached briefly so the self-healed note shows up soon.
      const ttl = (res: Response) => (isToday ? 600 : res.headers.get("x-daf-note") === "yes" ? 3600 : 120);
      return cachedResponse(ck(`${dafPath(ref.tractate, ref.daf)}?t=${isToday ? "today" : "perma"}&d=${ymd(today)}`), ttl, () => dafPageResponse(env, ctx, origin, ref, date, isToday, todayRef, today), bypass);
    }
    case "tractate": {
      const todayRef = dafForDate(today);
      return cachedResponse(ck(`/${route.tractate.slug}?d=${ymd(today)}`), 1800, async () => {
        const [noted, intro] = await Promise.all([
          notedDafim(env.DAF_KV, route.tractate),
          (async () => { const r = tractateIntroRef(route.tractate); if (!r) return null; try { return await fetchText(r, env.DAF_KV); } catch { return null; } })(),
        ]);
        return html(renderTractatePage({ env, origin, tractate: route.tractate, today: todayRef, todayDate: today, noted, intro }));
      }, bypass);
    }
    case "tractates": {
      const todayRef = dafForDate(today);
      return cachedResponse(ck(`/tractates?d=${ymd(today)}`), 3600, async () => html(renderTractatesIndex(env, origin, todayRef, today)), bypass);
    }
    case "about": {
      const todayRef = dafForDate(today);
      return cachedResponse(ck(`/about?d=${ymd(today)}`), 3600, async () => html(renderAbout(env, origin, todayRef)), bypass);
    }
    case "feed": {
      const utcToday = todayIn("UTC");
      return cachedResponse(ck(`/feed.xml?d=${ymd(utcToday)}`), 1800, async () => {
        const items: FeedItem[] = [];
        for (let i = 0; i < 14; i++) {
          const d = addDays(utcToday, -i);
          const ref = dafForDate(d);
          items.push({ date: d, ref, note: await getNote(env.DAF_KV, ref.tractate, ref.daf) });
        }
        return new Response(renderFeed(env, origin, items), { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
      }, bypass);
    }
    case "sitemap": {
      const cycle = dafForDate(today).cycle;
      return cachedResponse(ck("/sitemap.xml"), 86400, async () => {
        const urls: string[] = [`${origin}/`, `${origin}/about`, `${origin}/tractates`];
        for (const t of TRACTATES) {
          urls.push(`${origin}/${t.slug}`);
          for (let d = t.firstDaf; d <= t.lastDaf; d++) urls.push(`${origin}${dafPath(t, d)}`);
        }
        void cycle;
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${u}</loc></url>`).join("\n")}\n</urlset>\n`;
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
  }
}

/**
 * POST /admin/bake?slug=bekhorot&daf=2[&force=1]  or  ?date=YYYY-MM-DD
 * Header: authorization: Bearer <ADMIN_TOKEN>. Used by scripts/backfill.ts and for re-bakes after a style change.
 */
async function adminBake(request: Request, env: Env & { ADMIN_TOKEN?: string }, today: Date): Promise<Response> {
  if (request.method !== "POST") return new Response("POST only", { status: 405 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return new Response("unauthorized", { status: 401 });
  const url = new URL(request.url);
  let ref: DafRef;
  const dateParam = url.searchParams.get("date");
  if (dateParam) {
    const d = parseYmd(dateParam);
    if (!d) return new Response("bad date", { status: 400 });
    ref = dafForDate(d);
  } else {
    const t: Tractate | undefined = TRACTATES.find((x) => x.slug === url.searchParams.get("slug"));
    const daf = Number(url.searchParams.get("daf"));
    if (!t || !isValidDaf(t, daf)) return new Response("bad slug/daf", { status: 400 });
    const cycle = dafForDate(today).cycle;
    ref = dafForDate(dateForDaf(t, daf, cycle));
  }
  const outcome = await ensureNote(env, ref, { force: url.searchParams.has("force"), skipLock: true });
  return new Response(JSON.stringify({ daf: `${ref.tractate.slug}/${ref.daf}`, ...outcome }, null, 2), { status: outcome.status === "failed" ? 502 : 200, headers: JSON_H });
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
      return redirect(`https://${env.CANONICAL_HOST}${url.pathname}${url.search}`, 301);
    }
    const origin = url.origin;
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      console.error(e);
      const msg = e instanceof SefariaError ? e.message : "Something went wrong on our side.";
      return html(renderError(env, origin, msg), e instanceof SefariaError ? 502 : 500, { "cache-control": "no-store" });
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env, controller.scheduledTime).catch((e) => console.error("[cron]", e)));
  },
};
