/**
 * The map of the page, on the daf page: the block between the note and the text, the running head that follows
 * the reader down the text (filled and shown by public/app.js), and the marker at the first segment of each unit.
 * Pure: strings in, HTML out. The AI label sits above the map's words every time, as the note's does.
 */
import { en } from "../i18n/en";
import { strings } from "../i18n/format";
import type { Lang } from "../i18n/strings";
import { isMapKind, type MapKind } from "../map/kinds";
import type { DafMap } from "../map/store";
import { esc } from "./layout";
import { smartenText } from "./typography";

/** The English label, kept as an export: the tests read it here (the AI_LABEL idiom). */
export const MAP_AI_LABEL = en.mapAiLabel;

/** What a translated map stores (src/map/tstore.ts): the words of each unit in the English map's order, bound to it by `of`. */
export interface TranslatedMapLike { units: { title: string; gloss: string }[]; shape: string; of: string }

export interface MapViewUnit { n: number; kind: MapKind; from: string; to: string; title: string; gloss: string }
export interface MapView { shape: string; units: MapViewUnit[] }

/**
 * English: the map. Another language: kinds and ranges from the English map, words from its current translation.
 * Null when there is no map, when the translation is missing or stale, or when the ranges no longer chain over
 * this text from its first segment to its last (Sefaria can re-segment; a map that does not fit renders nothing,
 * never a wrong one).
 */
export function mapView(lang: Lang, map: DafMap | null, tmap: TranslatedMapLike | null, order: string[]): MapView | null {
  if (!map || map.units.length === 0 || order.length === 0) return null;
  const index = new Map(order.map((id, i) => [id, i] as const));
  let expected = 0;
  for (const u of map.units) {
    const f = index.get(u.from);
    const t = index.get(u.to);
    if (f === undefined || t === undefined || f !== expected || t < f || !isMapKind(u.kind)) return null;
    expected = t + 1;
  }
  if (expected !== order.length) return null;
  const units = (words: (i: number) => { title: string; gloss: string }): MapViewUnit[] =>
    map.units.map((u, i) => ({ n: i + 1, kind: u.kind, from: u.from, to: u.to, ...words(i) }));
  if (lang === "en") return { shape: map.shape, units: units((i) => ({ title: map.units[i]!.title, gloss: map.units[i]!.gloss })) };
  if (!tmap || tmap.of !== map.generatedAt || tmap.units.length !== map.units.length) return null;
  return { shape: tmap.shape, units: units((i) => ({ title: tmap.units[i]!.title, gloss: tmap.units[i]!.gloss })) };
}

/** Segment id to unit number (for data-unit), and the unit that starts at each segment (for the markers). */
export function segUnits(view: MapView, order: string[]): { unitOf: Map<string, number>; startsAt: Map<string, MapViewUnit> } {
  const unitOf = new Map<string, number>();
  const startsAt = new Map<string, MapViewUnit>();
  const index = new Map(order.map((id, i) => [id, i] as const));
  for (const u of view.units) {
    for (let i = index.get(u.from)!; i <= index.get(u.to)!; i++) unitOf.set(order[i]!, u.n);
    startsAt.set(u.from, u);
  }
  return { unitOf, startsAt };
}

/** Curly quotes by hand where the page pass cannot reach: attribute values and anything inside the Sefaria fence. */
const curl = (lang: Lang, s: string) => (lang === "en" ? smartenText(s) : s);

/** "3 of 6 · An objection: But the ox is different", the running head's text for a unit. */
export function unitHead(lang: Lang, u: MapViewUnit, total: number): string {
  const S = strings(lang);
  return S.mapHead(S.mapUnitOf(u.n, total), S.mapKind[u.kind], u.title);
}

export function renderPageMap(view: MapView, lang: Lang): string {
  const S = strings(lang);
  const total = view.units.length;
  const items = view.units.map((u) => `<li class="pagemap-unit" id="pagemap-u${u.n}" data-unit="${u.n}" data-head="${esc(curl(lang, unitHead(lang, u, total)))}">
      <a class="pagemap-link" href="#${esc(u.from)}"><span class="unit-kind">${esc(S.mapKind[u.kind])}</span> <span class="unit-title">${esc(u.title)}</span></a>
      <span class="unit-gloss">${esc(u.gloss)}</span>
    </li>`).join("\n");
  // The kinds on this page, each glossed once, in order of first appearance; a language with no glosses gets no legend.
  const seen = new Set<MapKind>();
  const legend: string[] = [];
  for (const u of view.units) {
    if (seen.has(u.kind)) continue;
    seen.add(u.kind);
    const g = S.mapKindGloss[u.kind];
    if (g) legend.push(`<b>${esc(S.mapKind[u.kind])}</b>: ${esc(g)}.`);
  }
  // The map's own toggle (Joe, 2026-09-22): open by default; some readers hide the map and read the daf, others hide
  // the daf and read the notes. Wired by the generic button[data-toggle] loop in public/app.js; html.map-hidden hides
  // the map's body, the markers in the text and the running head, and the head script restores it before paint.
  const toggle = `<button type="button" class="pagemap-toggle" data-toggle="map" data-off="${esc(S.toggleMap[0])}" data-on="${esc(S.toggleMap[1])}" aria-pressed="false" aria-controls="pagemap-body">${esc(S.toggleMap[0])}</button>`;
  return `<nav class="pagemap" id="pagemap" aria-labelledby="pagemap-h">
  <div class="pagemap-head"><h2 id="pagemap-h" class="pagemap-h">${esc(S.mapHeading)}</h2>${toggle}</div>
  <div class="pagemap-body" id="pagemap-body">
  <p class="note-label pagemap-label"><span class="ai">${esc(S.mapAiBadge)}</span> ${esc(S.mapAiLabel)}</p>
  <p class="pagemap-shape">${esc(view.shape)}</p>
  <ol class="pagemap-units">
    ${items}
  </ol>${legend.length ? `\n  <p class="pagemap-kinds muted">${legend.join(" ")}</p>` : ""}
  </div>
</nav>`;
}

export interface Turn { href: string; word: string; label: string }

/** The running head: hidden until app.js has a unit to show; the page turns sit at its ends. */
export function renderHereBar(lang: Lang, prev: Turn | null, next: Turn | null): string {
  const S = strings(lang);
  const turn = (t: Turn | null, arrow: string) => (t ? `<a class="here-turn" href="${esc(t.href)}" aria-label="${esc(S.turnAria(t.word, t.label))}">${arrow}</a>` : `<span class="here-turn"></span>`);
  return `<nav class="here-bar" aria-label="${esc(S.hereBarAria)}" hidden>
  ${turn(prev, S.arrowPrev)}
  <a class="here-text" href="#pagemap" title="${esc(S.hereBackTitle)}"></a>
  ${turn(next, S.arrowNext)}
</nav>`;
}

/** The marker at the first segment of a unit. It sits inside the Sefaria fence, so its title is curled here, then escaped. */
export function unitMarker(lang: Lang, u: MapViewUnit): string {
  const S = strings(lang);
  return `<a class="unit-mark" href="#pagemap-u${u.n}"><span class="unit-kind">${esc(S.mapKind[u.kind])}</span> <span class="unit-title">${esc(curl(lang, u.title))}</span></a>`;
}
