/**
 * The sitemap lists what deserves indexing: the pages, every tractate, and every daf that has a note or is
 * today's. A daf without a note is Sefaria's text under another roof and is noindex until its note exists
 * (src/render/dafPage.ts), so it is left out here too; listing a noindex URL contradicts itself.
 *
 * lastmod is given only where it is known (a note's generatedAt from KV metadata): a guessed lastmod gets
 * the whole file's dates ignored.
 */
import type { Env } from "../types";
import { TRACTATES, dafPath, type Tractate } from "../daf/tractates";
import { ymd, type DafRef } from "../daf/schedule";
import { ENABLED_LANGS, p } from "../i18n/strings";
import { isPublicLang } from "./layout";
import { notedDafimWithDates } from "../note/store";

/** slug → (daf → note generatedAt, or null when the note predates metadata). */
export type NotedIndex = Map<string, Map<number, string | null>>;

export async function loadNoted(kv: KVNamespace, tractates: Tractate[] = TRACTATES): Promise<NotedIndex> {
  const entries = await Promise.all(tractates.map(async (t) => [t.slug, await notedDafimWithDates(kv, t)] as const));
  return new Map(entries);
}

/** The rendered sitemap lives in KV: building it means 40 lists (~12 s cold), which is longer than a crawler waits. */
export const SITEMAP_KEY = "sitemap:v1";
export const SITEMAP_MAX_AGE_S = 3600;

export interface StoredSitemap { xml: string; builtAt: string }

/**
 * Serve the stored sitemap at once; rebuild it in the background when it is older than an hour or missing
 * (the very first request builds inline). `later` is ctx.waitUntil.
 */
export async function sitemapXml(kv: KVNamespace, build: () => Promise<string>, later: (p: Promise<unknown>) => void, now = Date.now()): Promise<string> {
  const stored = await kv.get<StoredSitemap>(SITEMAP_KEY, "json");
  const rebuild = async () => { const xml = await build(); await kv.put(SITEMAP_KEY, JSON.stringify({ xml, builtAt: new Date(now).toISOString() })); return xml; };
  if (!stored) return rebuild();
  if (now - Date.parse(stored.builtAt) > SITEMAP_MAX_AGE_S * 1000) later(rebuild().catch((e) => console.error("[sitemap] rebuild", e)));
  return stored.xml;
}

export interface SitemapInput { origin: string; env: Env; today: Date; todayRef: DafRef; noted: NotedIndex; tractates?: Tractate[] }

function esc(s: string): string { return s.replace(/&/g, "&amp;"); }

export function renderSitemap(i: SitemapInput): string {
  const langs = ENABLED_LANGS.filter((l) => isPublicLang(i.env, l));
  const tractates = i.tractates ?? TRACTATES;
  const alt = (path: string) => langs.length > 1
    ? langs.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(i.origin + p(l, path))}"/>`).join("") + `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(i.origin + path)}"/>`
    : "";
  const urls: string[] = [];
  const add = (path: string, lastmod?: string | null) => {
    for (const l of langs) urls.push(`<url><loc>${esc(i.origin + p(l, path))}</loc>${lastmod ? `<lastmod>${esc(lastmod)}</lastmod>` : ""}${alt(path)}</url>`);
  };
  add("/", ymd(i.today));
  add("/about");
  add("/tractates");
  for (const t of tractates) {
    const noted = i.noted.get(t.slug) ?? new Map<number, string | null>();
    let latest: string | null = null;
    const dafs: [number, string | null][] = [];
    for (let d = t.firstDaf; d <= t.lastDaf; d++) {
      const isToday = i.todayRef.tractate.slug === t.slug && i.todayRef.daf === d;
      if (!noted.has(d) && !isToday) continue;
      const when = noted.get(d) ?? null;
      if (when && (!latest || when > latest)) latest = when;
      dafs.push([d, when]);
    }
    add(`/${t.slug}`, latest);
    for (const [d, when] of dafs) add(dafPath(t, d), when);
  }
  urls.push(`<url><loc>${esc(i.origin)}/newsletter</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}
