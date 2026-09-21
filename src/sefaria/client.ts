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
import { shekalimDafYomiMap } from "@hebcal/learning/DafPageEvent";

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

/** Rabbi Steinsaltz's Hebrew biur for one Sefaria ref: the Talmud's words in bold, his explanation between. */
export interface BiurText {
  urlRef: string;
  ref: string;
  heRef: string;
  /** Sanitized HTML per segment, explanation runs wrapped in <span class="elu">, section labels bold. */
  html: string[];
  plain: string[];
  version: TextVersion | null;
  fetchedAt: string;
}

/**
 * "Bekhorot.2a" → "Steinsaltz_on_Bekhorot.2a"; "Jerusalem_Talmud_Shekalim.1.1.1-2.2.3" → "Steinsaltz_on_Jerusalem_Talmud_Shekalim…".
 * Null for the Mishnah days (Kinnim, Middot), which have no Steinsaltz commentary on Sefaria.
 */
export function biurRef(urlRef: string): string | null {
  if (/^Mishnah_/.test(urlRef)) return null;
  return `Steinsaltz_on_${urlRef}`;
}

/** The biur is cached like the text: on the edge, 30 days, never in KV. Null when this ref has none. */
export async function fetchBiur(urlRef: string): Promise<BiurText | null> {
  const ref = biurRef(urlRef);
  if (!ref) return null;
  const key = `text:v2:${ref}`;
  const cached = await edgeGet<BiurText>(key);
  if (cached) return cached;
  const url = `${SEFARIA}/api/v3/texts/${encodeURI(ref)}?version=hebrew`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new SefariaError(`Sefaria returned HTTP ${res.status} for ${ref}`, res.status);
  const j: any = await res.json();
  if (j.error) return null;
  const heV = pickVersion(Array.isArray(j.versions) ? j.versions : [], "he");
  const he = heV ? flatten(heV.text) : [];
  if (he.length === 0) return null;
  const biur: BiurText = {
    urlRef: ref,
    ref: String(j.ref ?? ref),
    heRef: String(j.heRef ?? ""),
    html: he.map((x) => sanitize(x, { markElucidation: true, bigAsLabel: true })),
    plain: he.map((x) => plainText(x)),
    version: heV ? { language: "he", versionTitle: String(heV.versionTitle ?? ""), license: String(heV.license ?? ""), versionSource: heV.versionSource ? String(heV.versionSource) : undefined } : null,
    fetchedAt: new Date().toISOString(),
  };
  await edgePut(key, biur, TEXT_TTL_SECONDS);
  return biur;
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


export interface DafSection { label: string; text: SefariaText; biur?: BiurText | null }

/** hebcal's own Shekalim mapping (Yerushalmi chapter:halakha:segment), used when Sefaria's calendar ref has no text. */
function hebcalShekalimRef(daf: number): string | null {
  const map = shekalimDafYomiMap as Record<string, string>;
  const a = map[`${daf}a`]; const b = map[`${daf}b`];
  if (!a || !b) return null;
  const aStart = a.split("-")[0]!; const bEnd = b.includes("-") ? b.split("-")[1]! : b;
  return `Jerusalem_Talmud_Shekalim.${`${aStart}-${bEnd}`.replaceAll(":", ".")}`;
}

/**
 * All the text that makes up a daf, tolerating two quirks of the source:
 *  - a side that does not exist (Nazir 33b is blank in the printed Talmud; Sefaria 404s) is skipped;
 *  - a Shekalim range from Sefaria's calendar that returns no text falls back to hebcal's mapping,
 *    and the working ref replaces the cached one.
 * Throws only if nothing at all could be loaded.
 */
export async function loadDafSections(t: Tractate, daf: number, cycle: number, kv?: KVNamespace, opts: { withBiur?: boolean } = {}): Promise<DafSection[]> {
  const resolved = await resolveDafRefs(t, daf, cycle, kv);
  const out: DafSection[] = [];
  let firstError: unknown = null;
  // The biur is decoration for the Hebrew page: a failure to load it never fails the page.
  const biurFor = async (urlRef: string) => (opts.withBiur ? fetchBiur(urlRef).catch(() => null) : undefined);
  for (let i = 0; i < resolved.urlRefs.length; i++) {
    const urlRef = resolved.urlRefs[i]!;
    try {
      const [text, biur] = await Promise.all([fetchText(urlRef, kv), biurFor(urlRef)]);
      out.push({ label: resolved.labels[i] ?? urlRef, text, biur });
    } catch (e) {
      const missing = e instanceof SefariaError && (e.status === 404 || /no text/i.test(e.message));
      if (missing && i > 0) continue; // e.g. Nazir 33b: side a stands alone
      if (missing && t.slug === "shekalim") {
        const alt = hebcalShekalimRef(daf);
        if (alt && alt !== urlRef) {
          const [text, biur] = await Promise.all([fetchText(alt, kv), biurFor(alt)]);
          out.push({ label: resolved.labels[i] ?? alt, text, biur });
          if (kv) await kv.put(`ref:v1:${t.slug}:${daf}`, JSON.stringify({ urlRefs: [alt], labels: resolved.labels } satisfies ResolvedDaf));
          continue;
        }
      }
      firstError ??= e;
    }
  }
  if (out.length === 0) throw firstError ?? new SefariaError(`No text could be loaded for ${t.name} ${daf}`);
  return out;
}
