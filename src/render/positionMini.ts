/**
 * One bar that zooms. Level 0: the whole Talmud, plain, with today marked.
 * Tap: the six Orders appear (1); tap: this Order's tractates (2); tap: this
 * tractate's dapim (3); tap: back out. Every level is drawn in days, so each
 * zoom is an exact scale of the last; public/app.js animates the transforms.
 * Same ordinal ramp tokens (--s1..--s6) as the About-page diagram.
 * The stage itself is always left-to-right (a time axis), whatever the page's
 * language; only the caption line below it follows the page direction.
 */
import { CYCLE_LENGTH, TRACTATES, type Tractate } from "../daf/tractates";
import { cycleOffset, type DafRef } from "../daf/schedule";
import type { Lang } from "../i18n/strings";
import { dafNum, num, sederShort, strings, tractateName } from "../i18n/format";
import { SEDARIM } from "./dafYomiDiagram";
import { esc } from "./layout";

function amudToDaf(ref: string): number {
  return Number(/^(\d+)/.exec(ref)?.[1] ?? NaN);
}
const pc = (f: number) => `${(f * 100).toFixed(3)}%`;

export function renderPositionMini(ref: DafRef, learnedThroughDaf: number, lang: Lang = "en"): string {
  const S = strings(lang);
  const t: Tractate = ref.tractate;
  const si = SEDARIM.findIndex((s) => s.name === t.seder);
  const sederLabel = (s: { name: string; he: string }) => (lang === "he" ? s.he : s.name.replace("Seder ", ""));

  // Geometry in fractions of the whole cycle.
  const sederDays = new Map<string, number>();
  for (const x of TRACTATES) sederDays.set(x.seder, (sederDays.get(x.seder) ?? 0) + x.days);
  let acc = 0;
  const orderStart = new Map<string, number>();
  for (const s of SEDARIM) { orderStart.set(s.name, acc); acc += sederDays.get(s.name) ?? 0; }
  const o0 = (orderStart.get(t.seder) ?? 0) / CYCLE_LENGTH;
  const o1 = o0 + (sederDays.get(t.seder) ?? 0) / CYCLE_LENGTH;
  const t0 = cycleOffset(t, t.firstDaf) / CYCLE_LENGTH;
  const t1 = t0 + t.days / CYCLE_LENGTH;
  const todayFrac = (ref.dayInCycle - 0.5) / CYCLE_LENGTH;

  // Level 1: the six Orders (labels in their own unscaled layer).
  let x = 0;
  const orderGeo: string[] = [];
  const orderLabels: string[] = [];
  SEDARIM.forEach((s, i) => {
    const w = (sederDays.get(s.name) ?? 0) / CYCLE_LENGTH;
    const cur = s.name === t.seder ? " cur" : "";
    orderGeo.push(`<span class="ms s${i + 1}${cur}" style="width:${pc(w)}" title="${esc(lang === "he" ? `סדר ${s.he}` : s.name)}"></span>`);
    if (w >= 0.09) orderLabels.push(`<span style="left:${pc(x)};width:${pc(w)}">${esc(sederLabel(s))}</span>`);
    x += w;
  });

  // Level 2: the tractates of this Order.
  const inSeder = TRACTATES.filter((y) => y.seder === t.seder);
  const sd = sederDays.get(t.seder) ?? 1;
  x = 0;
  const tractGeo: string[] = [];
  const tractLabels: string[] = [];
  for (const y of inSeder) {
    const w = y.days / sd;
    const cur = y.slug === t.slug ? " cur" : "";
    tractGeo.push(`<span class="ms t s${si + 1}${cur}" style="width:${pc(w)}" title="${esc(S.tractateAria(tractateName(lang, y), y.days))}"></span>`);
    if (w >= 0.1) tractLabels.push(`<span style="left:${pc(x)};width:${pc(w)}">${esc(tractateName(lang, y))}</span>`);
    x += w;
  }
  const tractateIndex = inSeder.findIndex((y) => y.slug === t.slug) + 1;

  // Level 3: this tractate's dapim.
  const chapterStarts = new Set(t.chapters.map((c) => amudToDaf(c.startDaf)).filter((n) => n > t.firstDaf));
  const cells: string[] = [];
  for (let d = t.firstDaf; d <= t.lastDaf; d++) {
    const cls = ["dc", d === ref.daf ? "today" : d < learnedThroughDaf ? "past" : "", chapterStarts.has(d) ? "chapter-start" : ""].filter(Boolean).join(" ");
    cells.push(`<span class="${cls}" title="${esc(tractateName(lang, t))} ${esc(dafNum(lang, d))}"></span>`);
  }

  const regions = [[0, 1], [0, 1], [o0, o1], [t0, t1]];
  const sederName = sederShort(lang, t.seder, t.sederHe);
  const caps = [S.capTalmud, S.capOrders, sederName, tractateName(lang, t)];
  const vals = [
    S.dayOf(num(lang, ref.dayInCycle), num(lang, CYCLE_LENGTH)),
    S.orderOf(sederName, si + 1, 6),
    S.tractateOf(tractateIndex, inSeder.length),
    S.dafOf(dafNum(lang, ref.daf), dafNum(lang, t.lastDaf)),
  ];
  const aria = S.zoomAria(String(ref.dayInCycle), String(CYCLE_LENGTH), lang === "he" ? t.sederHe : t.seder, tractateName(lang, t), tractateIndex, inSeder.length, dafNum(lang, ref.daf), dafNum(lang, t.lastDaf));

  return `<div class="zoom" tabindex="0" role="button" aria-label="${esc(aria)}"
  data-regions='${JSON.stringify(regions)}' data-today="${todayFrac.toFixed(6)}" data-caps='${esc(JSON.stringify(caps))}' data-vals='${esc(JSON.stringify(vals))}' data-hint-in="${esc(S.zoomHintIn)}" data-hint-out="${esc(S.zoomHintOut)}">
  <div class="zoom-stage">
    <div class="zl on" data-l="0"><div class="geo"><span class="ms plain" style="width:100%"></span></div></div>
    <div class="zl" data-l="1"><div class="geo">${orderGeo.join("")}</div><div class="labels">${orderLabels.join("")}</div></div>
    <div class="zl" data-l="2"><div class="geo">${tractGeo.join("")}</div><div class="labels">${tractLabels.join("")}</div></div>
    <div class="zl" data-l="3"><div class="geo dapim s${si + 1}">${cells.join("")}</div></div>
    <span class="zmark" style="left:${pc(todayFrac)}"></span>
  </div>
  <p class="zoom-line"><span class="zcap">${esc(caps[0])}</span><span class="sep" aria-hidden="true">·</span><span class="zval">${esc(vals[0])}</span><span class="zoom-hint">${esc(S.zoomHintIn)}</span></p>
</div>`;
}
