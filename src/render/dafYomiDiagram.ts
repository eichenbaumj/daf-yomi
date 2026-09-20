/**
 * "How Daf Yomi works," drawn from the same tractate table the schedule runs on.
 * HTML + CSS for the proportional bars (so labels reflow on phones), one small
 * inline SVG for the page itself. Colours for the six Orders are an ordinal ramp
 * (one hue, darkening in canonical order) set as CSS tokens in styles.css; the
 * legend and direct labels carry identity so colour is never the only cue.
 */
import { CYCLE_LENGTH, TRACTATES, type Tractate } from "../daf/tractates";
import { cycleEndDate, cycleStartDate, longDate, shortDate, type DafRef } from "../daf/schedule";
import { esc } from "./layout";

/** Canonical order of the six Sedarim with a plain gloss for newcomers. */
export const SEDARIM: { name: string; he: string; gloss: string }[] = [
  { name: "Seder Zeraim", he: "זרעים", gloss: "Seeds: blessings and prayer (the farming laws have no Babylonian Gemara)" },
  { name: "Seder Moed", he: "מועד", gloss: "Appointed times: Shabbat and the festivals" },
  { name: "Seder Nashim", he: "נשים", gloss: "Women: marriage, divorce, vows" },
  { name: "Seder Nezikin", he: "נזיקין", gloss: "Damages: civil law, courts, idolatry, ethics" },
  { name: "Seder Kodashim", he: "קדשים", gloss: "Holy things: the Temple and its offerings" },
  { name: "Seder Tahorot", he: "טהרות", gloss: "Purities: only Niddah has a Babylonian Gemara" },
];

function yearsMonths(days: number): string {
  const years = Math.floor(days / 365.25);
  const months = Math.round((days - years * 365.25) / 30.44);
  return `${years} years and ${months} months`;
}

export function renderDafYomiDiagram(today: DafRef): string {
  const cycle = today.cycle;
  const start = cycleStartDate(cycle);
  const end = cycleEndDate(cycle);
  const bySeder = new Map<string, Tractate[]>();
  for (const t of TRACTATES) {
    if (!bySeder.has(t.seder)) bySeder.set(t.seder, []);
    bySeder.get(t.seder)!.push(t);
  }
  const pct = (days: number) => `${((days / CYCLE_LENGTH) * 100).toFixed(3)}%`;

  // Row 1: the six Orders, proportional to their days.
  let offset = 0;
  const sederSegments = SEDARIM.map((s, i) => {
    const list = bySeder.get(s.name) ?? [];
    const days = list.reduce((a, t) => a + t.days, 0);
    const seg = `<div class="seg seder s${i + 1}" style="width:${pct(days)}" title="${esc(s.name)}: ${days} days"><span class="lbl">${esc(s.name.replace("Seder ", ""))}</span></div>`;
    offset += days;
    return { html: seg, days };
  });

  // Row 2: every tractate, proportional, coloured by its Order.
  const tractateSegments = TRACTATES.map((t) => {
    const si = SEDARIM.findIndex((s) => s.name === t.seder) + 1;
    const isNow = t.slug === today.tractate.slug;
    return `<a class="seg tractate s${si}${isNow ? " now" : ""}" style="width:${pct(t.days)}" href="/${esc(t.slug)}" title="${esc(t.name)}: ${t.days} days"><span class="lbl">${esc(t.name)}</span></a>`;
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
    return `<li><span class="chip s${i + 1}" aria-hidden="true"></span><b>${esc(s.name.replace("Seder ", ""))}</b> <span lang="he" dir="rtl" class="he-inline">${esc(s.he)}</span> <span class="muted">${esc(s.gloss)}. ${list.length} tractate${list.length === 1 ? "" : "s"}, ${days} days.</span></li>`;
  }).join("");

  return `
<figure class="dy-diagram" aria-labelledby="dy-title">
  <figcaption id="dy-title" class="sr-only">How the Daf Yomi cycle is laid out</figcaption>

  <div class="dy-stats">
    <div><span class="num">1</span><span class="what">daf a day</span></div>
    <div><span class="num">2,711</span><span class="what">dapim in the Babylonian Talmud</span></div>
    <div><span class="num">${esc(yearsMonths(CYCLE_LENGTH))}</span><span class="what">to read the whole thing</span></div>
  </div>

  <div class="dy-page">
    <svg viewBox="0 0 120 84" width="120" height="84" role="img" aria-label="One daf: a leaf with two sides, a and b">
      <rect x="4" y="4" width="112" height="76" rx="3" fill="var(--paper-2)" stroke="var(--rule)"/>
      <line x1="60" y1="4" x2="60" y2="80" stroke="var(--rule)"/>
      <g stroke="var(--ink-3)" stroke-width="1.5" stroke-linecap="round">
        <line x1="14" y1="22" x2="50" y2="22"/><line x1="14" y1="32" x2="50" y2="32"/><line x1="14" y1="42" x2="44" y2="42"/><line x1="14" y1="52" x2="50" y2="52"/><line x1="14" y1="62" x2="38" y2="62"/>
        <line x1="70" y1="22" x2="106" y2="22"/><line x1="70" y1="32" x2="100" y2="32"/><line x1="70" y1="42" x2="106" y2="42"/><line x1="70" y1="52" x2="94" y2="52"/><line x1="70" y1="62" x2="106" y2="62"/>
      </g>
      <text x="32" y="15" text-anchor="middle" font-size="8" fill="var(--accent)" font-family="var(--serif)">2a</text>
      <text x="88" y="15" text-anchor="middle" font-size="8" fill="var(--accent)" font-family="var(--serif)">2b</text>
    </svg>
    <p><b>A daf is one leaf, both sides.</b> Side a, then side b. The Talmud's pages have been numbered the same way since the first printed editions five hundred years ago, so "Berakhot 2a" means the same page in every edition and every language. Numbering starts at 2 because the title page is 1; each tractate starts fresh.</p>
  </div>

  <p class="dy-label">The six Orders of the Talmud, sized by how many days each takes</p>
  <div class="dy-bar" role="img" aria-label="Six Orders as a proportional bar">${sederSegments.map((s) => s.html).join("")}</div>
  <p class="dy-label">The ${TRACTATES.length} tractates inside them (tap any to open it)</p>
  <div class="dy-bar dy-tractates">${tractateSegments.join("")}</div>
  <div class="dy-axis">
    ${ticks.join("")}
    <span class="${todayClass}" style="left:${todayLeft}"><i></i><span class="you">You are here: day ${today.dayInCycle.toLocaleString("en-US")}, ${esc(today.tractate.name)} ${today.daf}</span></span>
  </div>
  <p class="dy-label muted">Cycle ${cycle}: ${esc(longDate(start))} to ${esc(longDate(end))}. The cycle has run without a break since 1923; everyone learning Daf Yomi anywhere in the world is on the same page today.</p>

  <ul class="dy-legend">${legend}</ul>
  <p class="muted small">Shekalim is read from the Jerusalem Talmud and three short tractates near the end of Kodashim (Kinnim, Tamid, Middot) are mostly Mishnah, which is why the count is 40 blocks and not the 37 tractates with a Babylonian Gemara. First and last: Berakhot 2 on ${esc(shortDate(start))}, Niddah 73 on ${esc(shortDate(end))}.</p>
</figure>`;
}
