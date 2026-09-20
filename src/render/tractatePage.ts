import type { Env } from "../types";
import { TRACTATES, dafPath, introRef, type Tractate } from "../daf/tractates";
import { dateForDaf, shortDate, ymd, type DafRef } from "../daf/schedule";
import type { SefariaText } from "../sefaria/client";
import { esc, page } from "./layout";

export interface TractatePageModel {
  env: Env;
  origin: string;
  tractate: Tractate;
  today: DafRef;
  todayDate: Date;
  noted: Set<number>;
  intro: SefariaText | null;
}

export function renderTractatePage(m: TractatePageModel): string {
  const t = m.tractate;
  const cycle = m.today.cycle;
  const todayKey = ymd(m.todayDate);
  const cells: string[] = [];
  for (let d = t.firstDaf; d <= t.lastDaf; d++) {
    const date = dateForDaf(t, d, cycle);
    const k = ymd(date);
    const cls = ["cell", k === todayKey ? "today" : k < todayKey ? "past" : "future", m.noted.has(d) ? "noted" : ""].filter(Boolean).join(" ");
    cells.push(`<a class="${cls}" href="${dafPath(t, d)}" title="${esc(shortDate(date))}${m.noted.has(d) ? " · has a note" : ""}"><span class="n">${d}</span><span class="d">${esc(shortDate(date))}</span></a>`);
  }
  const chapters = t.chapters.length
    ? `<ol class="chapters">${t.chapters.map((c) => `<li><span class="ch-title">${esc(c.title)}</span> <span lang="he" dir="rtl" class="he-inline">${esc(c.heTitle)}</span> <span class="muted">${esc(c.startDaf)}–${esc(c.endDaf)}</span></li>`).join("")}</ol>`
    : "";
  const intro = m.intro
    ? `<details class="intro"><summary>Rabbi Steinsaltz's introduction to ${esc(t.name)}</summary>
<div class="intro-body">${m.intro.enHtml.map((s) => `<p>${s}</p>`).join("\n")}</div>
<p class="credit">${esc(m.intro.enVersion?.versionTitle ?? "")}${m.intro.enVersion?.license ? ` (${esc(m.intro.enVersion.license)})` : ""} · <a href="https://www.sefaria.org/${esc(m.intro.urlRef)}" rel="noopener">On Sefaria</a></p></details>`
    : "";
  const prevT = TRACTATES[t.order - 1];
  const nextT = TRACTATES[t.order + 1];
  const start = dateForDaf(t, t.firstDaf, cycle);
  const end = dateForDaf(t, t.lastDaf, cycle);

  const body = `
<article class="tractate">
  <header class="daf-head">
    <p class="date">${esc(t.seder)} ${t.sederHe ? `<span lang="he" dir="rtl" class="he-inline">${esc(t.sederHe)}</span>` : ""}</p>
    <h1>${esc(t.name)} <span lang="he" dir="rtl" class="he-title">${esc(t.heTitle)}</span></h1>
    <p class="position"><span>${t.days} days</span><span class="sep" aria-hidden="true">·</span><span>Dapim ${t.firstDaf}–${t.lastDaf}</span><span class="sep" aria-hidden="true">·</span><span>${esc(shortDate(start))} to ${esc(shortDate(end))} in cycle ${cycle}</span></p>
    ${t.shortDesc ? `<p class="lede">${esc(t.shortDesc)}</p>` : ""}
    ${t.description ? `<p class="muted small">${esc(t.description)} <span class="muted">(Sefaria's description.)</span></p>` : ""}
  </header>
  ${chapters ? `<h2>Chapters</h2>${chapters}` : ""}
  ${intro}
  <h2>Every daf</h2>
  <p class="muted small">Dates are for cycle ${cycle}. A dot marks pages that already have a note.</p>
  <div class="grid">${cells.join("")}</div>
  <nav class="prevnext" aria-label="Neighbouring tractates">
    ${prevT ? `<a href="/${esc(prevT.slug)}">← ${esc(prevT.name)}</a>` : "<span></span>"}
    <a href="/tractates">All tractates</a>
    ${nextT ? `<a href="/${esc(nextT.slug)}">${esc(nextT.name)} →</a>` : "<span></span>"}
  </nav>
</article>`;
  return page({
    env: m.env,
    origin: m.origin,
    title: `${t.name}: every daf, Daf Yomi in English`,
    description: `Tractate ${t.name} (${t.heTitle}) of the Babylonian Talmud in English: all ${t.days} dapim with their Daf Yomi dates, chapters, and Rabbi Steinsaltz's introduction. ${t.shortDesc}`.trim(),
    canonicalPath: `/${t.slug}`,
    body,
    bodyClass: "tractate-page",
  });
}

export function tractateIntroRef(t: Tractate): string | null {
  const ref = introRef(t);
  return ref ? ref.replace(/ /g, "_") : null;
}
