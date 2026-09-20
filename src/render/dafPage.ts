import type { Env } from "../types";
import { dafLabel, dafPath, type Tractate } from "../daf/tractates";
import { adjacentDaf, hebrewDate, hebrewDateHe, longDate, ymd, type DafRef } from "../daf/schedule";
import { positionFor, type Position } from "../daf/position";
import type { SefariaText } from "../sefaria/client";
import { plainText, sanitize } from "../sefaria/sanitize";
import type { DafNote } from "../note/store";
import { esc, page } from "./layout";

export interface DafPageModel {
  env: Env;
  origin: string;
  ref: DafRef;
  date: Date;
  isToday: boolean;
  texts: { label: string; text: SefariaText }[];
  note: DafNote | null;
  notesEnabled: boolean;
}

export const AI_LABEL = "Written by Claude, an AI, from Rabbi Steinsaltz's English. Not a scholar. Here to get you thinking, not to tell you what it means.";

export function positionStrip(p: Position): string {
  const items: string[] = [];
  if (p.seder) items.push(`<span>${esc(p.seder)}${p.sederHe ? ` <span lang="he" dir="rtl" class="he-inline">${esc(p.sederHe)}</span>` : ""}</span>`);
  items.push(`<span>${esc(p.tractate)}${p.tractateHe ? ` <span lang="he" dir="rtl" class="he-inline">${esc(p.tractateHe)}</span>` : ""}</span>`);
  if (p.chapterLabel) items.push(`<span title="${esc(p.chapterTitles.join(" / "))}">${esc(p.chapterLabel)}</span>`);
  items.push(`<span>${esc(p.dafOfTractate)}</span>`);
  items.push(`<span>Day ${p.dayInCycle.toLocaleString("en-US")} of ${p.cycleLength.toLocaleString("en-US")}</span>`);
  return `<p class="position">${items.join('<span class="sep" aria-hidden="true">·</span>')}</p>`;
}

function noteBox(m: DafPageModel): string {
  const { note } = m;
  if (note) {
    return `<aside class="note" aria-labelledby="note-h">
  <p class="note-label" id="note-h"><span class="ai">AI note</span> ${esc(AI_LABEL)}</p>
  <p class="note-summary">${esc(note.summary)}</p>
  <p class="note-question">${esc(note.question)}</p>
</aside>`;
  }
  const why = m.notesEnabled
    ? "The note for this page has not been written yet. It usually appears a minute or two after the first visit; reload to check."
    : "Notes are not switched on for this deployment.";
  return `<aside class="note note-pending" aria-labelledby="note-h">
  <p class="note-label" id="note-h"><span class="ai">AI note</span> ${esc(AI_LABEL)}</p>
  <p class="note-summary muted">${esc(why)}</p>
</aside>`;
}

function versionCredit(t: SefariaText): string {
  const bits: string[] = [];
  if (t.enVersion) bits.push(`English: ${esc(t.enVersion.versionTitle)}${t.enVersion.license ? ` (${esc(t.enVersion.license)})` : ""}`);
  if (t.heVersion) bits.push(`Hebrew/Aramaic: ${esc(t.heVersion.versionTitle)}${t.heVersion.license ? ` (${esc(t.heVersion.license)})` : ""}`);
  bits.push(`<a href="https://www.sefaria.org/${esc(t.urlRef)}?lang=bi" rel="noopener">Open on Sefaria</a>`);
  return bits.join(" · ");
}

function amudSection(label: string, t: SefariaText, anchor: string): string {
  const n = Math.max(t.en.length, t.he.length);
  const items: string[] = [];
  for (let i = 0; i < n; i++) {
    const en = t.en[i] ? sanitize(t.en[i]!, { markElucidation: true }) : "";
    const he = t.he[i] ? sanitize(t.he[i]!) : "";
    items.push(`<li class="seg" id="${anchor}-${i + 1}">
  <a class="segno" href="#${anchor}-${i + 1}" aria-label="Segment ${i + 1}">${i + 1}</a>
  ${en ? `<p class="en" lang="en">${en}</p>` : `<p class="en muted" lang="en">(no English for this segment)</p>`}
  ${he ? `<p class="he" lang="he" dir="rtl">${he}</p>` : ""}
</li>`);
  }
  return `<section class="amud" id="${anchor}" aria-labelledby="${anchor}-h">
  <h2 id="${anchor}-h">${esc(label)}</h2>
  <ol class="segments">${items.join("\n")}</ol>
  <p class="credit">${versionCredit(t)}</p>
</section>`;
}

export function scholarLinks(t: Tractate, daf: number, urlRef: string | undefined): string {
  const links: string[] = [];
  const hadran = (t as Tractate & { hadranSlug?: string }).hadranSlug;
  if (hadran) links.push(`<a href="https://hadran.org.il/daf/${esc(hadran)}-${daf}/" rel="noopener">Hadran</a> <span class="muted">(Rabbanit Michelle Farber's daily shiur and summary)</span>`);
  links.push(`<a href="https://www.dafyomi.co.il/" rel="noopener">Kollel Iyun Hadaf</a> <span class="muted">(Point by Point summaries, Insights, Background)</span>`);
  links.push(`<a href="https://steinsaltz.org/todays-daf/" rel="noopener">Steinsaltz Center</a> <span class="muted">(daily essays)</span>`);
  if (urlRef) links.push(`<a href="https://www.sefaria.org/${esc(urlRef)}?lang=bi" rel="noopener">Sefaria</a> <span class="muted">(the text with commentaries)</span>`);
  return `<ul class="deeper">${links.map((l) => `<li>${l}</li>`).join("")}</ul>`;
}

export function renderDafPage(m: DafPageModel): string {
  const { ref, env } = m;
  const t = ref.tractate;
  const p = positionFor(ref);
  const label = dafLabel(t, ref.daf);
  const prev = adjacentDaf(t, ref.daf, -1);
  const next = adjacentDaf(t, ref.daf, 1);
  const firstText = m.texts[0]?.text;
  const description = m.note
    ? m.note.summary
    : `${label}: the day's page of Talmud in English, with where it sits in the cycle.`;
  const headline = m.isToday ? `Today's daf is ${label}` : label;
  const dateLine = `${longDate(m.date)} <span class="sep" aria-hidden="true">·</span> ${esc(hebrewDate(m.date))} <span lang="he" dir="rtl" class="he-inline">${esc(hebrewDateHe(m.date))}</span>`;

  const sections = m.texts.map((x, i) => amudSection(x.label, x.text, i === 0 ? "a" : i === 1 ? "b" : `s${i + 1}`)).join("\n");
  const anyHebrew = m.texts.some((x) => x.text.he.length > 0);
  const anyElu = m.texts.some((x) => x.text.en.some((s) => /<b>|<strong>/i.test(s)));

  const body = `
<article class="daf">
  <header class="daf-head">
    <p class="date">${dateLine}${m.isToday ? "" : ` <span class="sep" aria-hidden="true">·</span> <a href="/date/${ymd(m.date)}" class="muted">learned on this date</a>`}</p>
    <h1>${esc(headline)} <span lang="he" dir="rtl" class="he-title">${esc(t.heTitle)}</span></h1>
    ${positionStrip(p)}
    <p class="cycle muted">Cycle ${p.cycle} ends ${esc(longDate(p.cycleEnd))}. ${p.percentThroughCycle}% of the way through the Talmud.</p>
  </header>

  ${noteBox(m)}

  <div class="tools" role="group" aria-label="Reading options">
    ${anyHebrew ? `<button type="button" class="toggle" data-toggle="he" aria-pressed="false">Show Hebrew / Aramaic</button>` : ""}
    ${anyElu ? `<button type="button" class="toggle" data-toggle="talmudOnly" aria-pressed="false">Talmud only</button>` : ""}
    <p class="legend muted"><b>Bold</b> is the Talmud's own words; regular weight is Rabbi Steinsaltz's explanation woven in.</p>
  </div>

  ${sections}

  <nav class="prevnext" aria-label="Neighbouring pages">
    ${prev ? `<a rel="prev" href="${dafPath(prev.tractate, prev.daf)}">← ${esc(dafLabel(prev.tractate, prev.daf))}</a>` : "<span></span>"}
    <a href="/${esc(t.slug)}">All of ${esc(t.name)}</a>
    ${next ? `<a rel="next" href="${dafPath(next.tractate, next.daf)}">${esc(dafLabel(next.tractate, next.daf))} →</a>` : "<span></span>"}
  </nav>

  <section class="deeper-wrap">
    <h2>Go deeper</h2>
    <p class="muted">Real teachers, every day, for free:</p>
    ${scholarLinks(t, ref.daf, firstText?.urlRef)}
  </section>
</article>`;

  return page({
    env,
    origin: m.origin,
    title: m.isToday ? `Today: ${label}` : label,
    description: plainText(description).slice(0, 300),
    canonicalPath: dafPath(t, ref.daf),
    body,
    bodyClass: "daf-page",
    ogType: "article",
  });
}
