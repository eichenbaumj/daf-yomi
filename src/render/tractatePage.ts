import type { Env } from "../types";
import { SEFARIA_CLOSE, SEFARIA_OPEN } from "./typography";
import { TRACTATES, dafPath, introRef, type Tractate } from "../daf/tractates";
import { dateForDaf, ymd, type DafRef } from "../daf/schedule";
import type { SefariaText } from "../sefaria/client";
import { p, type Lang } from "../i18n/strings";
import { dafNum, shortDateL, strings, tractateName } from "../i18n/format";
import { esc, page } from "./layout";

export interface TractatePageModel {
  env: Env;
  origin: string;
  lang?: Lang;
  tractate: Tractate;
  today: DafRef;
  todayDate: Date;
  noted: Set<number>;
  intro: SefariaText | null;
}

/** "2a" → "ב׳ ע״א" for the Hebrew chapter ranges. */
function amudHe(ref: string): string {
  const m = /^(\d+)([ab])$/.exec(ref);
  return m ? `${dafNum("he", Number(m[1]))} ${m[2] === "a" ? "ע״א" : "ע״ב"}` : ref;
}

export function renderTractatePage(m: TractatePageModel): string {
  const lang = m.lang ?? "en";
  const S = strings(lang);
  const t = m.tractate;
  const name = tractateName(lang, t);
  const cycle = m.today.cycle;
  const todayKey = ymd(m.todayDate);
  const cells: string[] = [];
  for (let d = t.firstDaf; d <= t.lastDaf; d++) {
    const date = dateForDaf(t, d, cycle);
    const k = ymd(date);
    const cls = ["cell", k === todayKey ? "today" : k < todayKey ? "past" : "future", m.noted.has(d) ? "noted" : ""].filter(Boolean).join(" ");
    cells.push(`<a class="${cls}" href="${p(lang, dafPath(t, d))}" title="${esc(shortDateL(lang, date))}${m.noted.has(d) ? esc(S.hasNote) : ""}"><span class="n">${esc(dafNum(lang, d))}</span><span class="d">${esc(shortDateL(lang, date))}</span></a>`);
  }
  const chapters = t.chapters.length
    ? `<ol class="chapters">${t.chapters.map((c) => lang === "en"
      ? `<li><span class="ch-title">${esc(c.title)}</span> <span lang="he" dir="rtl" class="he-inline">${esc(c.heTitle)}</span> <span class="muted">${esc(c.startDaf)}–${esc(c.endDaf)}</span></li>`
      : `<li><span class="ch-title">${esc(c.heTitle)}</span> <span class="muted">${esc(amudHe(c.startDaf))} – ${esc(amudHe(c.endDaf))}</span></li>`).join("")}</ol>`
    : "";
  const introHtml = m.intro ? (lang === "he" ? m.intro.heHtml : m.intro.enHtml) : [];
  const introVersion = lang === "he" ? m.intro?.heVersion : m.intro?.enVersion;
  const intro = m.intro && introHtml.length
    ? `<details class="intro"><summary>${esc(S.introSummary(name))}</summary>
<div class="intro-body">${SEFARIA_OPEN}${introHtml.map((s) => `<p>${s}</p>`).join("\n")}${SEFARIA_CLOSE}</div>
<p class="credit">${esc(introVersion?.versionTitle ?? "")}${introVersion?.license ? ` (${esc(introVersion.license)})` : ""} · <a href="https://www.sefaria.org/${esc(m.intro.urlRef)}${lang === "he" ? "?lang=he" : ""}" rel="noopener">${esc(S.onSefaria)}</a></p></details>`
    : "";
  const prevT = TRACTATES[t.order - 1];
  const nextT = TRACTATES[t.order + 1];
  const start = dateForDaf(t, t.firstDaf, cycle);
  const end = dateForDaf(t, t.lastDaf, cycle);
  const shortDesc = lang === "he" ? t.heShortDesc ?? "" : t.shortDesc;
  const heTitleSpan = lang === "en" ? ` <span lang="he" dir="rtl" class="he-title">${esc(t.heTitle)}</span>` : "";
  const sederLine = lang === "en"
    ? `${esc(t.seder)} ${t.sederHe ? `<span lang="he" dir="rtl" class="he-inline">${esc(t.sederHe)}</span>` : ""}`
    : esc(t.sederHe || t.seder);
  const dapim = lang === "en" ? S.dapimRange(t.firstDaf, t.lastDaf) : `דפים ${dafNum("he", t.firstDaf)}–${dafNum("he", t.lastDaf)}`;

  const body = `
<article class="tractate">
  <header class="daf-head">
    <p class="date">${sederLine}</p>
    <h1>${esc(name)}${heTitleSpan}</h1>
    <p class="position"><span>${esc(S.daysN(t.days))}</span><span class="sep" aria-hidden="true">·</span><span>${esc(dapim)}</span><span class="sep" aria-hidden="true">·</span><span>${esc(S.dateRangeCycle(shortDateL(lang, start), shortDateL(lang, end), cycle))}</span></p>
    ${shortDesc ? `<p class="lede">${esc(shortDesc)}</p>` : ""}
    ${lang === "en" && t.description ? `<p class="muted small">${esc(t.description)} <span class="muted">${esc(S.sefariaDescription)}</span></p>` : ""}
  </header>
  ${chapters ? `<h2>${esc(S.chaptersHeading)}</h2>${chapters}` : ""}
  ${intro}
  <h2>${esc(S.everyDafHeading)}</h2>
  <p class="muted small">${esc(S.datesNote(cycle))}</p>
  <div class="grid">${cells.join("")}</div>
  <nav class="prevnext" aria-label="${esc(S.neighbourTractatesAria)}">
    ${prevT ? `<a href="${p(lang, `/${esc(prevT.slug)}`)}">${S.arrowPrev} ${esc(tractateName(lang, prevT))}</a>` : "<span></span>"}
    <a href="${p(lang, "/tractates")}">${esc(S.allTractates)}</a>
    ${nextT ? `<a href="${p(lang, `/${esc(nextT.slug)}`)}">${esc(tractateName(lang, nextT))} ${S.arrowNext}</a>` : "<span></span>"}
  </nav>
</article>`;
  return page({
    env: m.env,
    origin: m.origin,
    lang,
    title: S.tractateTitle(name),
    description: S.tractateDescription(name, t.heTitle, t.days, shortDesc),
    canonicalPath: `/${t.slug}`,
    body,
    bodyClass: "tractate-page",
    jsonLd: [{
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: m.env.SITE_NAME, item: `${m.origin}${p(lang, "/")}` },
        { "@type": "ListItem", position: 2, name: S.breadcrumbTractates, item: `${m.origin}${p(lang, "/tractates")}` },
        { "@type": "ListItem", position: 3, name, item: `${m.origin}${p(lang, `/${t.slug}`)}` },
      ],
    }],
  });
}

export function tractateIntroRef(t: Tractate): string | null {
  const ref = introRef(t);
  return ref ? ref.replace(/ /g, "_") : null;
}
