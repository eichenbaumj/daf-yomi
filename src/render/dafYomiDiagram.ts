/**
 * "How Daf Yomi works," drawn from the same tractate table the schedule runs on.
 * HTML + CSS for the proportional bars (so labels reflow on phones), one small
 * inline SVG for the page itself. Colours for the six Orders are an ordinal ramp
 * (one hue, darkening in canonical order) set as CSS tokens in styles.css; the
 * legend and direct labels carry identity so colour is never the only cue.
 * The bars and the axis are a time line and stay left-to-right in every language.
 */
import { CYCLE_LENGTH, TRACTATES, type Tractate } from "../daf/tractates";
import { cycleEndDate, cycleStartDate, type DafRef } from "../daf/schedule";
import type { Lang } from "../i18n/strings";
import { dafLabelL, longDateL, num, shortDateL, strings, tractateName } from "../i18n/format";
import { p } from "../i18n/strings";
import { esc } from "./layout";

/** Canonical order of the six Sedarim with a plain gloss for newcomers (the gloss text lives in src/i18n). */
export const SEDARIM: { name: string; he: string; gloss: string }[] = [
  { name: "Seder Zeraim", he: "זרעים", gloss: "Seeds: blessings and prayer (the farming laws have no Babylonian Gemara)" },
  { name: "Seder Moed", he: "מועד", gloss: "Appointed times: Shabbat and the festivals" },
  { name: "Seder Nashim", he: "נשים", gloss: "Women: marriage, divorce, vows" },
  { name: "Seder Nezikin", he: "נזיקין", gloss: "Damages: civil law, courts, idolatry, ethics" },
  { name: "Seder Kodashim", he: "קדשים", gloss: "Holy things: the Temple and its offerings" },
  { name: "Seder Tahorot", he: "טהרות", gloss: "Purities: only Niddah has a Babylonian Gemara" },
];

export function renderDafYomiDiagram(today: DafRef, lang: Lang = "en"): string {
  const S = strings(lang);
  const cycle = today.cycle;
  const start = cycleStartDate(cycle);
  const end = cycleEndDate(cycle);
  const bySeder = new Map<string, Tractate[]>();
  for (const t of TRACTATES) {
    if (!bySeder.has(t.seder)) bySeder.set(t.seder, []);
    bySeder.get(t.seder)!.push(t);
  }
  const pct = (days: number) => `${((days / CYCLE_LENGTH) * 100).toFixed(3)}%`;
  const sederLabel = (s: { name: string; he: string }) => (lang === "he" ? s.he : s.name.replace("Seder ", ""));
  const sederFull = (s: { name: string; he: string }) => (lang === "he" ? `סדר ${s.he}` : s.name);

  // Row 1: the six Orders, proportional to their days.
  let offset = 0;
  const sederSegments = SEDARIM.map((s, i) => {
    const list = bySeder.get(s.name) ?? [];
    const days = list.reduce((a, t) => a + t.days, 0);
    const narrow = days / CYCLE_LENGTH < 0.06 ? " narrow" : "";
    const seg = `<div class="dseg seder s${i + 1}${narrow}" style="width:${pct(days)}" title="${esc(sederFull(s))}: ${esc(S.daysN(days))}"><span class="lbl">${esc(sederLabel(s))}</span></div>`;
    offset += days;
    return { html: seg, days };
  });

  // Row 2: every tractate, proportional, coloured by its Order.
  const tractateSegments = TRACTATES.map((t) => {
    const si = SEDARIM.findIndex((s) => s.name === t.seder) + 1;
    const isNow = t.slug === today.tractate.slug;
    const name = tractateName(lang, t);
    return `<a class="dseg tractate s${si}${isNow ? " now" : ""}" style="width:${pct(t.days)}" href="${p(lang, `/${esc(t.slug)}`)}" title="${esc(name)}: ${esc(S.daysN(t.days))}" aria-label="${esc(S.tractateAria(name, t.days))}"></a>`;
  });

  // Year ticks along the cycle.
  const ticks: string[] = [];
  for (let y = start.getFullYear() + 1; y <= end.getFullYear(); y++) {
    const jan1 = new Date(y, 0, 1);
    const day = Math.round((jan1.getTime() - start.getTime()) / 86400000);
    if (day > 0 && day < CYCLE_LENGTH) ticks.push(`<span class="tick" style="left:${pct(day)}"><i></i>${y}</span>`);
  }
  const todayLeft = pct(today.dayInCycle - 0.5);
  const frac = today.dayInCycle / CYCLE_LENGTH;
  const todayClass = frac > 0.72 ? "today late" : frac < 0.14 ? "today early" : "today";

  const legend = SEDARIM.map((s, i) => {
    const list = bySeder.get(s.name) ?? [];
    const days = list.reduce((a, t) => a + t.days, 0);
    const heInline = lang === "en" ? ` <span lang="he" dir="rtl" class="he-inline">${esc(s.he)}</span>` : "";
    return `<li><span class="chip s${i + 1}" aria-hidden="true"></span><b>${esc(sederLabel(s))}</b>${heInline} <span class="muted">${esc(S.sederGloss[i]!)}. ${esc(S.legendCount(list.length, days))}</span></li>`;
  }).join("");
  const years = Math.floor(CYCLE_LENGTH / 365.25);
  const months = Math.round((CYCLE_LENGTH - years * 365.25) / 30.44);

  return `
<figure class="dy-diagram" aria-labelledby="dy-title">
  <figcaption id="dy-title" class="sr-only">${esc(S.diagramCaption)}</figcaption>

  <div class="dy-stats">
    <div><span class="num">1</span><span class="what">${esc(S.statDafADay)}</span></div>
    <div><span class="num">${num(lang, CYCLE_LENGTH)}</span><span class="what">${esc(S.statDapim)}</span></div>
    <div><span class="num">${esc(S.yearsMonths(years, months))}</span><span class="what">${esc(S.statToRead)}</span></div>
  </div>

  <div class="dy-page">
    <svg viewBox="0 0 120 84" width="120" height="84" role="img" aria-label="${esc(S.dafSvgAria)}">
      <rect x="4" y="4" width="112" height="76" rx="3" fill="var(--paper-2)" stroke="var(--rule)"/>
      <line x1="60" y1="4" x2="60" y2="80" stroke="var(--rule)"/>
      <g stroke="var(--ink-3)" stroke-width="1.5" stroke-linecap="round">
        <line x1="14" y1="22" x2="50" y2="22"/><line x1="14" y1="32" x2="50" y2="32"/><line x1="14" y1="42" x2="44" y2="42"/><line x1="14" y1="52" x2="50" y2="52"/><line x1="14" y1="62" x2="38" y2="62"/>
        <line x1="70" y1="22" x2="106" y2="22"/><line x1="70" y1="32" x2="100" y2="32"/><line x1="70" y1="42" x2="106" y2="42"/><line x1="70" y1="52" x2="94" y2="52"/><line x1="70" y1="62" x2="106" y2="62"/>
      </g>
      <text x="32" y="15" text-anchor="middle" font-size="8" fill="var(--accent)" font-family="var(--serif)">2a</text>
      <text x="88" y="15" text-anchor="middle" font-size="8" fill="var(--accent)" font-family="var(--serif)">2b</text>
    </svg>
    <p>${S.dafExplainer}</p>
  </div>

  <p class="dy-label">${esc(S.ordersLabel)}</p>
  <div class="dy-bar" role="img" aria-label="${esc(S.ordersAria)}">${sederSegments.map((s) => s.html).join("")}</div>
  <p class="dy-label">${esc(S.tractatesLabel(TRACTATES.length))}</p>
  <div class="dy-bar dy-tractates">${tractateSegments.join("")}</div>
  <div class="dy-axis">
    ${ticks.join("")}
    <span class="${todayClass}" style="left:${todayLeft}"><i></i><span class="you">${esc(S.youAreHere(num(lang, today.dayInCycle), dafLabelL(lang, today.tractate, today.daf)))}</span></span>
  </div>
  <p class="dy-label muted">${esc(S.cycleCaption(cycle, longDateL(lang, start), longDateL(lang, end)))}</p>

  <ul class="dy-legend">${legend}</ul>
  <p class="muted small">${esc(S.diagramFootnote(shortDateL(lang, start), shortDateL(lang, end)))}</p>
</figure>`;
}
