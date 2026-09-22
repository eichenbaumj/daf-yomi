/**
 * The per-daf share card: the image behind a shared link (1200x630, the size every crawler wants).
 * It carries the AI note itself (the summary; Joe: "the notes are beautiful and best first"; the question waits on
 * the page) in the page's own palette and type. The share button copies only the link, so a text thread shows
 * this card and nothing else.
 *
 * This file is pure: HTML in, HTML out. The fonts arrive as an argument (src/og/fonts.ts holds the
 * bytes; the preview script reads the same files from disk) and the PNG is made elsewhere
 * (src/og/browser.ts, Browser Rendering). The page exposes two functions for the renderer:
 * `__dafSet(model)` swaps the texts so one browser page serves a whole batch, and `__dafFit()`
 * shrinks the question's type until it fits, so a question is never cut.
 *
 * Bump CARD_VERSION when the design changes: cards carrying an older version are re-rendered by the
 * trickle (src/og/bake.ts) but keep serving meanwhile, since their question is still the current one.
 */
import { smartenText } from "../render/typography";
import { TRACTATES } from "../daf/tractates";
import { SEDARIM } from "../render/dafYomiDiagram";
import type { Lang } from "../i18n/strings";
import { fnv1a } from "../util";
import { esc } from "../render/layout";

export const CARD_VERSION = 2;
export const CARD_W = 1200;
export const CARD_H = 630;

export interface FontFace {
  family: string;
  style: "normal" | "italic";
  /** "400" or a variable range "400 600". */
  weight: string;
  unicodeRange: string;
  /** The woff2 bytes, base64. */
  base64: string;
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** FontFace records from a manifest (src/og/fonts/manifest.json) and a bytes lookup; the Worker and the preview script share it. */
export function facesFrom(entries: readonly { file: string; family: string; style: string; weight: string; unicodeRange: string }[], bytes: Record<string, ArrayBuffer>): FontFace[] {
  return entries.map((e) => {
    const b = bytes[e.file];
    if (!b) throw new Error(`font bytes missing for ${e.file}`);
    return { family: e.family, style: e.style as FontFace["style"], weight: e.weight, unicodeRange: e.unicodeRange, base64: toBase64(b) };
  });
}

export interface CardModel {
  lang: Lang;
  /** "Bekhorot 9" */
  label: string;
  /** "בכורות" */
  heTitle: string;
  /** "Monday, 21 September 2026" */
  dateWords: string;
  /** "10 Tishrei 5787" */
  hebrewDateWords: string;
  /** The note's summary: what the card shows. */
  summary: string;
  /** Kept for the alt text and the Hebrew seam; not drawn. */
  question: string;
  dayInCycle: number;
  cycleLength: number;
  wordmark: string;
  aiChip: string;
  aiLine: string;
  /** "daf-yomi.dev" */
  site: string;
}

/** The six Orders, sized by days, in the ordinal ramp styles.css uses (--s1 to --s6). */
export const ORDERS: { name: string; days: number; color: string }[] = SEDARIM.map((s, i) => ({
  name: s.name,
  days: TRACTATES.filter((t) => t.seder === s.name).reduce((a, t) => a + t.days, 0),
  color: ["#b9893a", "#a4702f", "#8c5828", "#734322", "#5b311c", "#432116"][i]!,
}));

/** A four-pointed star, the site's ✦, as SVG: the embedded fonts have no U+2726 and the renderer has no fallback font for it. */
export const STAR_SVG = (size: string, fill = "#a9812f") =>
  `<svg class="star" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M12 0C12.6 7 17 11.4 24 12C17 12.6 12.6 17 12 24C11.4 17 7 12.6 0 12C7 11.4 11.4 7 12 0Z" fill="${fill}"/></svg>`;

/** Where the position tick sits over the Orders bar, in px from the card's left edge (the bar spans 90..1110). */
export function tickLeft(dayInCycle: number, cycleLength: number): number {
  return Math.round((90 + ((dayInCycle - 0.5) / cycleLength) * (CARD_W - 180)) * 10) / 10;
}

/**
 * The version token in the image URL. Any re-render changes it (renderedAt), so crawlers that cache by URL
 * (Facebook, Slack, the edge cache) never keep an old picture: the page reads the token from the stored card.
 */
export function cardToken(x: { generatedAt: string; renderedAt: string; cycle: number }, cv = CARD_VERSION): string {
  return fnv1a(`${cv}|${x.cycle}|${x.generatedAt}|${x.renderedAt}`);
}

/** Largest and smallest type for the note; the fit loop steps down by one until the text sits inside the hero box. */
export const Q_MAX_PX = 34;
export const Q_MIN_PX = 22;

/** Runs inside the card page. Kept as a string so the renderer can `evaluate` it and tests can read it. */
export const CARD_SCRIPT = `
window.__dafFit = function () {
  var q = document.getElementById("q"), box = document.getElementById("hero");
  var s = ${Q_MAX_PX};
  q.style.fontSize = s + "px";
  while (s > ${Q_MIN_PX} && q.scrollHeight > box.clientHeight) { s -= 1; q.style.fontSize = s + "px"; }
  return s;
};
window.__dafSet = function (m) {
  document.getElementById("label").textContent = m.label;
  document.getElementById("he").textContent = m.heTitle;
  document.getElementById("date").textContent = m.dateWords + " \\u00b7 " + m.hebrewDateWords;
  document.getElementById("qt").textContent = m.summary;
  document.getElementById("tick").style.left = (90 + ((m.dayInCycle - 0.5) / m.cycleLength) * ${CARD_W - 180}).toFixed(1) + "px";
  return window.__dafFit();
};
`;

function fontFaces(fonts: readonly FontFace[]): string {
  return fonts.map((f) =>
    `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:block;src:url(data:font/woff2;base64,${f.base64}) format("woff2");unicode-range:${f.unicodeRange}}`,
  ).join("\n");
}

export function renderCardHtml(m: CardModel, fonts: readonly FontFace[]): string {
  const rtl = m.lang !== "en";
  const bar = ORDERS.map((o) => `<i style="flex:${o.days} ${o.days} 0;background:${o.color}"></i>`).join("");
  return `<!doctype html>
<html lang="${m.lang}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<style>
${fontFaces(fonts)}
:root{--paper:#f3ead7;--ink:#2b2118;--ink-2:#66563f;--ink-3:#98876c;--rule:#d3c2a0;--accent:#8b2e1f;--gold:#a9812f;--serif:"Source Serif 4",Georgia,"Times New Roman",serif;--hebrew:"Frank Ruhl Libre","Noto Serif Hebrew",serif}
html,body{margin:0;padding:0}
body{width:${CARD_W}px;height:${CARD_H}px;overflow:hidden;background:var(--paper);color:var(--ink);font-family:var(--serif);position:relative;-webkit-font-smoothing:antialiased}
.orders{position:absolute;left:90px;right:90px;top:62px;height:12px;display:flex;gap:3px}
.orders i{display:block;height:100%}
#tick{position:absolute;top:55px;width:4px;height:26px;margin-left:-2px;background:var(--accent);border-radius:1px}
.row{position:absolute;left:90px;right:90px;top:102px;display:flex;justify-content:space-between;align-items:center}
.mark{display:flex;align-items:center;gap:12px;color:var(--gold);font-size:23px;letter-spacing:.14em;font-weight:600}
.chip{color:var(--accent);border:2px solid var(--accent);border-radius:999px;padding:5px 16px 6px;font-size:17px;letter-spacing:.12em;font-weight:600;line-height:1}
.title{position:absolute;left:90px;right:90px;top:150px;font-size:46px;font-weight:600;line-height:1.1;letter-spacing:-.01em;white-space:nowrap;overflow:hidden}
#label{margin-inline-end:.38em}
.title .he{font-family:var(--hebrew);font-weight:400;color:var(--ink-2);font-size:40px}
.date{position:absolute;left:90px;right:90px;top:212px;font-size:24px;color:var(--ink-2)}
#hero{position:absolute;left:90px;right:90px;top:262px;height:280px}
#q{margin:0;font-size:${Q_MAX_PX}px;line-height:1.3;color:var(--ink);text-wrap:pretty}
#q .star{display:inline-block;vertical-align:.05em;margin-inline-end:.3em}
.foot{position:absolute;left:90px;right:90px;top:560px;border-top:2px solid var(--rule);padding-top:15px;display:flex;justify-content:space-between;align-items:baseline}
.site{color:var(--accent);font-weight:600;font-size:30px;letter-spacing:.01em}
.ai{color:var(--ink-2);font-size:22px}
</style>
</head>
<body>
<div class="orders" aria-hidden="true">${bar}</div>
<div id="tick" style="left:${tickLeft(m.dayInCycle, m.cycleLength)}px"></div>
<div class="row">
  <div class="mark">${STAR_SVG("22px")}<span>${esc(smartenText(m.wordmark))}</span></div>
  <div class="chip">${esc(m.aiChip)}</div>
</div>
<div class="title"><span id="label">${esc(m.label)}</span><span class="he" id="he" lang="he" dir="rtl">${esc(m.heTitle)}</span></div>
<div class="date" id="date">${esc(m.dateWords)} · ${esc(m.hebrewDateWords)}</div>
<div id="hero"><p id="q">${STAR_SVG(".55em")}<span id="qt">${esc(smartenText(m.summary))}</span></p></div>
<div class="foot"><span class="site">${esc(m.site)}</span><span class="ai">${esc(m.aiLine)}</span></div>
<script>${CARD_SCRIPT}
window.__dafFit();
</script>
</body>
</html>`;
}
