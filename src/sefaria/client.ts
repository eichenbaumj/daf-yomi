/**
 * Sefaria text access. Every text on the site comes from here; nothing is
 * generated locally. Responses are cached on the edge (Cache API, no write
 * quota) for 30 days; KV is not used for text, so a crawl of all 2,711 pages
 * cannot exhaust the free plan's 1,000 KV writes a day.
 */
import { dateForDaf } from "../daf/schedule";
import type { Tractate } from "../daf/tractates";
import { plainText, sanitize } from "./sanitize";
import { edgeGet, edgePut } from "../edgecache";

export const SEFARIA = "https://www.sefaria.org";
const UA = "daf-yomi-site (Cloudflare Worker; joe@group17a.com)";
const TEXT_TTL_SECONDS = 60 * 60 * 24 * 30;

export class SefariaError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "SefariaError";
  }
}

export interface TextVersion {
  language: "en" | "he";
  versionTitle: string;
  license: string;
  versionSource?: string;
}
export interface SefariaText {
  /** Sefaria URL form, e.g. "Bekhorot.2a" */
  urlRef: string;
  ref: string;
  heRef: string;
  /** Raw Sefaria HTML per segment (kept for provenance). */
  en: string[];
  he: string[];
  /** Sanitized at cache time so page renders are string concatenation: HTML with <span class="elu"> wrapping, and plain text. */
  enHtml: string[];
  heHtml: string[];
  enPlain: string[];
  enVersion: TextVersion | null;
  heVersion: TextVersion | null;
  next: string | null;
  prev: string | null;
  fetchedAt: string;
}

function flatten(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) for (const y of x) flatten(y, out);
  else if (typeof x === "string") out.push(x);
  return out;
}

function pickVersion(versions: any[], lang: "en" | "he"): any | undefined {
  return versions.find((v) => v.language === lang && Array.isArray(v.text) ? flatten(v.text).length > 0 : false)
    ?? versions.find((v) => v.language === lang);
}

/** "Bekhorot 2a" → "Bekhorot.2a"; complex node refs keep commas and just swap spaces. */
export function toUrlRef(ref: string): string {
  const m = /^(.*?) (\d+[ab]?(?::\d+(?:-\d+)?)?)$/.exec(ref);
  if (m && !ref.includes(",")) return `${m[1]!.replace(/ /g, "_")}.${m[2]!.replace(/:/g, ".")}`;
  return ref.replace(/ /g, "_");
}

export async function fetchText(urlRef: string, _kv?: KVNamespace): Promise<SefariaText> {
  const key = `text:v2:${urlRef}`;
  const cached = await edgeGet<SefariaText>(key);
  if (cached) return cached;
  const url = `${SEFARIA}/api/v3/texts/${encodeURI(urlRef)}?version=english&version=hebrew`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new SefariaError(`Sefaria returned HTTP ${res.status} for ${urlRef}`, res.status);
  const j: any = await res.json();
  if (j.error) throw new SefariaError(`Sefaria: ${j.error}`);
  const versions: any[] = Array.isArray(j.versions) ? j.versions : [];
  const enV = pickVersion(versions, "en");
  const heV = pickVersion(versions, "he");
  const en = enV ? flatten(enV.text) : [];
  const he = heV ? flatten(heV.text) : [];
  if (en.length === 0 && he.length === 0) throw new SefariaError(`Sefaria returned no text for ${urlRef}`);
  const toVersion = (v: any, language: "en" | "he"): TextVersion | null =>
    v ? { language, versionTitle: String(v.versionTitle ?? ""), license: String(v.license ?? ""), versionSource: v.versionSource ? String(v.versionSource) : undefined } : null;
  const text: SefariaText = {
    urlRef,
    ref: String(j.ref ?? urlRef),
    heRef: String(j.heRef ?? ""),
    en,
    he,
    enHtml: en.map((x) => sanitize(x, { markElucidation: true })),
    heHtml: he.map((x) => sanitize(x)),
    enPlain: en.map((x) => plainText(x)),
    enVersion: toVersion(enV, "en"),
    heVersion: toVersion(heV, "he"),
    next: j.next ? String(j.next) : null,
    prev: j.prev ? String(j.prev) : null,
    fetchedAt: new Date().toISOString(),
  };
  await edgePut(key, text, TEXT_TTL_SECONDS);
  return text;
}

export interface ResolvedDaf {
  /** One or two Sefaria URL refs covering the daf (two amudim for Bavli; one range for Shekalim/Kinnim/Middot). */
  urlRefs: string[];
  labels: string[];
}

/**
 * Which Sefaria refs make up this daf. Bavli tractates are `{Title}.{n}a` and `{n}b`.
 * Shekalim (Yerushalmi), Kinnim and Middot (Mishnah) have no such pagination on
 * Sefaria, so we ask Sefaria's own Daf Yomi calendar for the date this daf falls
 * on in the given cycle and cache the answer for good.
 */
export async function resolveDafRefs(t: Tractate, daf: number, cycle: number, kv?: KVNamespace): Promise<ResolvedDaf> {
  if (t.refMode === "talmud") {
    const title = t.sefariaTitle.replace(/ /g, "_");
    const sides = daf === t.lastDaf && t.lastAmud === "a" ? ["a"] : ["a", "b"];
    return { urlRefs: sides.map((x) => `${title}.${daf}${x}`), labels: sides.map((x) => `${t.name} ${daf}${x}`) };
  }
  const key = `ref:v1:${t.slug}:${daf}`;
  if (kv) {
    const cached = await kv.get<ResolvedDaf>(key, "json");
    if (cached) return cached;
  }
  const d = dateForDaf(t, daf, cycle);
  const url = `${SEFARIA}/api/calendars?year=${d.getFullYear()}&month=${d.getMonth() + 1}&day=${d.getDate()}&timezone=UTC`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new SefariaError(`Sefaria calendar HTTP ${res.status}`, res.status);
  const j: any = await res.json();
  const item = (j.calendar_items ?? []).find((i: any) => i?.title?.en === "Daf Yomi");
  if (!item?.url) throw new SefariaError(`Sefaria calendar had no Daf Yomi item for ${url}`);
  // We asked for the exact date this daf falls on, so the item is ours by construction;
  // still make sure Sefaria named the same tractate (its displayValue for Kinnim/Middot
  // days is a Mishnah range like "Mishnah Kinnim 2:1-3:1", not a daf number).
  const got = String(item.displayValue?.en ?? "").toLowerCase();
  if (!got.includes(t.name.toLowerCase())) {
    throw new SefariaError(`Sefaria calendar disagrees for ${t.name} ${daf}: got "${got}"`);
  }
  const resolved: ResolvedDaf = { urlRefs: [String(item.url)], labels: [`${t.name} ${daf}`] };
  if (kv) await kv.put(key, JSON.stringify(resolved));
  return resolved;
}
