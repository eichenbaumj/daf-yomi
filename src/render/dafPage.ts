import type { Env } from "../types";
import { dafPath, type Tractate } from "../daf/tractates";
import { adjacentDaf, ymd, type DafRef } from "../daf/schedule";
import { chaptersForDaf, positionFor, type Position } from "../daf/position";
import type { BiurText, SefariaText } from "../sefaria/client";
import { plainText } from "../sefaria/sanitize";
import type { DafNote } from "../note/store";
import { currentTranslation, type TranslatedNote } from "../note/tstore";
import { p, type Lang } from "../i18n/strings";
import { dafLabelL, hebrewDateL, longDateL, strings, tractateName } from "../i18n/format";
import { en } from "../i18n/en";
import { esc, page } from "./layout";
import { renderPositionMini } from "./positionMini";
import { INLINE_SUBSCRIBE_HEAD, INLINE_SUBSCRIBE_TAIL, renderInlineSubscribe } from "./newsletterPages";
import { cardPath } from "../og/store";

export interface DafPageModel {
  env: Env;
  origin: string;
  /** Page language; English when absent. */
  lang?: Lang;
  ref: DafRef;
  date: Date;
  isToday: boolean;
  texts: { label: string; text: SefariaText; biur?: BiurText | null }[];
  note: DafNote | null;
  /** The note in the page's language, when the page is not English. Shown only while it belongs to `note`. */
  translation?: TranslatedNote | null;
  notesEnabled: boolean;
  /** Today's daf, for the "learned so far" fill; defaults to the page's own daf. */
  todayRef?: DafRef;
  /** Today's civil date, for the note-pending copy. */
  todayDate?: Date;
  /** The stored share card for this daf, when it shows the note on this page (src/og/store.ts `cardCurrent`). English only. */
  card?: { token: string } | null;
}

/** The English label and legend, kept as exports: the email and the tests read them here. */
export const AI_LABEL = en.aiLabel;
export const LEGEND = en.legend;

/** The words that the miniature bars do not already say: which Order, which chapter. */
export function positionStrip(p: Position): string {
  return positionStripL("en", p, p.chapterLabel, p.chapterTitles);
}
function positionStripL(lang: Lang, p: Position, chapterLabel: string, chapterTitles: string[]): string {
  const items: string[] = [];
  const seder = lang === "he" ? p.sederHe : p.seder;
  if (seder) items.push(`<span>${esc(seder)}${lang === "en" && p.sederHe ? ` <span lang="he" dir="rtl" class="he-inline">${esc(p.sederHe)}</span>` : ""}</span>`);
  if (chapterLabel) items.push(`<span>${esc(chapterLabel)}${chapterTitles.length ? `, <i>${esc(chapterTitles.join(" / "))}</i>` : ""}</span>`);
  return items.length ? `<p class="position">${items.join('<span class="sep" aria-hidden="true">·</span>')}</p>` : "";
}

function noteBox(m: DafPageModel, lang: Lang): string {
  const S = strings(lang);
  const { note } = m;
  const label = `<p class="note-label" id="note-h"><span class="ai">${esc(S.aiBadge)}</span> ${esc(S.aiLabel)}</p>`;
  const shown = lang === "en" ? note : currentTranslation(note, m.translation ?? null);
  if (shown) {
    // "Share this note": hidden until app.js runs (it needs the share sheet or the clipboard). It shares the permalink
    // and nothing else (never "/": the link must still be right tomorrow), so a text thread shows the card, not words.
    const shareUrl = `${m.origin}${p(lang, dafPath(m.ref.tractate, m.ref.daf))}`;
    const share = `<p class="note-share" hidden><button type="button" class="toggle share" data-share-url="${esc(shareUrl)}" data-share-done="${esc(S.shareDone)}">${esc(S.shareNote)}</button></p>`;
    return `<aside class="note" aria-labelledby="note-h">
  ${label}
  <p class="note-summary">${esc(shown.summary)}</p>
  <p class="note-question">${esc(shown.question)}</p>
  ${share}
</aside>`;
  }
  const daysAway = Math.abs(Math.round((m.date.getTime() - (m.todayDate ?? m.date).getTime()) / 86400000));
  const why = !m.notesEnabled
    ? esc(S.notesOff)
    : note && lang !== "en"
      ? S.translationPending(esc(dafPath(m.ref.tractate, m.ref.daf)))
      : esc(daysAway <= 3 ? S.notePendingNear : S.notePendingFar);
  return `<aside class="note note-pending" aria-labelledby="note-h">
  ${label}
  <p class="note-summary muted">${why}</p>
</aside>`;
}

function versionCredit(lang: Lang, t: SefariaText, biur: BiurText | null | undefined): string {
  const S = strings(lang);
  const bits: string[] = [];
  if (lang === "en") {
    if (t.enVersion) bits.push(esc(S.creditEnglish(t.enVersion.versionTitle, t.enVersion.license)));
    if (t.heVersion) bits.push(esc(S.creditHebrew(t.heVersion.versionTitle, t.heVersion.license)));
  } else {
    if (biur?.version) bits.push(esc(S.creditBiur(biur.version.versionTitle, biur.version.license)));
    if (t.heVersion) bits.push(esc(S.creditHebrew(t.heVersion.versionTitle, t.heVersion.license)));
  }
  bits.push(`<a href="https://www.sefaria.org/${esc(t.urlRef)}?lang=${lang === "en" ? "bi" : "he"}" rel="noopener">${esc(S.openOnSefaria)}</a>`);
  return bits.join(" · ");
}

function amudSection(lang: Lang, label: string, t: SefariaText, biur: BiurText | null | undefined, anchor: string): string {
  const S = strings(lang);
  const heRef = lang === "en" && t.heRef ? ` <span lang="he" dir="rtl" class="he-inline">${esc(t.heRef)}</span>` : "";
  const items: string[] = [];
  if (lang === "en") {
    const n = Math.max(t.en.length, t.he.length);
    for (let i = 0; i < n; i++) {
      const en = t.enHtml[i] ?? "";
      const he = t.heHtml[i] ?? "";
      items.push(`<li class="seg" id="${anchor}-${i + 1}">
  <a class="segno" href="#${anchor}-${i + 1}" aria-label="${esc(S.segmentAria(i + 1))}">${i + 1}</a>
  ${en ? `<p class="en" lang="en">${en}</p>` : `<p class="en muted" lang="en">${esc(S.noTextForSegment)}</p>`}
  ${he ? `<p class="he" lang="he" dir="rtl">${he}</p>` : ""}
</li>`);
    }
  } else {
    // Hebrew: the biur (the Talmud's words in bold, the explanation between) is the text; the bare original sits
    // behind the "show the original" toggle. Without a biur (the Mishnah days) the original is the text.
    const n = Math.max(biur?.html.length ?? 0, t.he.length);
    for (let i = 0; i < n; i++) {
      const b = biur?.html[i] ?? "";
      const he = t.heHtml[i] ?? "";
      const primary = b || he;
      items.push(`<li class="seg" id="${anchor}-${i + 1}">
  <a class="segno" href="#${anchor}-${i + 1}" aria-label="${esc(S.segmentAria(i + 1))}">${i + 1}</a>
  ${primary ? `<p class="en biur" lang="he">${primary}</p>` : `<p class="en muted" lang="he">${esc(S.noTextForSegment)}</p>`}
  ${b && he ? `<p class="he" lang="he" dir="rtl">${he}</p>` : ""}
</li>`);
    }
  }
  return `<section class="amud" id="${anchor}" aria-labelledby="${anchor}-h">
  <h2 id="${anchor}-h" class="amud-title"><span>${esc(label)}${heRef}</span></h2>
  <ol class="segments">${items.join("\n")}</ol>
  <p class="credit">${versionCredit(lang, t, biur)}</p>
</section>`;
}

export const MJL_SERIES_URL = "https://www.myjewishlearning.com/article/daf-yomi/";

/**
 * My Jewish Learning publishes one short essay per daf, on the morning of that daf. A daf that has
 * already arrived gets its own article; a future daf, or a tractate whose slug is unverified, gets
 * the series page so the link never lands on a 404.
 */
export function mjlUrl(t: Tractate, daf: number, published: boolean): string {
  return published && t.mjlSlug ? `https://www.myjewishlearning.com/article/${t.mjlSlug}-${daf}/` : MJL_SERIES_URL;
}

export function scholarLinks(t: Tractate, daf: number, urlRef: string | undefined, lang: Lang = "en", mjlPublished = true): string {
  const S = strings(lang);
  const links: string[] = [];
  if (t.hadranSlug) links.push(`<a href="https://hadran.org.il/${lang === "he" ? "he/" : ""}daf/${esc(t.hadranSlug)}-${daf}/" rel="noopener">Hadran</a> <span class="muted">${esc(S.hadranBlurb)}</span>`);
  links.push(`<a href="${esc(mjlUrl(t, daf, mjlPublished))}" rel="noopener">My Jewish Learning</a> <span class="muted">${esc(S.mjlBlurb)}</span>`);
  links.push(`<a href="https://www.dafyomi.co.il/" rel="noopener">Kollel Iyun Hadaf</a> <span class="muted">${esc(S.kollelBlurb)}</span>`);
  links.push(`<a href="https://steinsaltz.org/todays-daf/" rel="noopener">Steinsaltz Center</a> <span class="muted">${esc(S.steinsaltzCenterBlurb)}</span>`);
  if (urlRef) links.push(`<a href="https://www.sefaria.org/${esc(urlRef)}?lang=${lang === "en" ? "bi" : "he"}" rel="noopener">Sefaria</a> <span class="muted">${esc(S.sefariaBlurb)}</span>`);
  return `<ul class="deeper">${links.map((l) => `<li>${l}</li>`).join("")}</ul>`;
}

/** Amud label in the page's language: "Bekhorot 2a" / "בכורות ב׳ ע״א". */
function amudLabel(lang: Lang, t: Tractate, daf: number, i: number, fallback: string): string {
  if (lang === "en") return fallback;
  const side = t.refMode === "talmud" ? (i === 0 ? " ע״א" : i === 1 ? " ע״ב" : "") : "";
  return `${dafLabelL(lang, t, daf)}${side}`;
}

export function renderDafPage(m: DafPageModel): string {
  const lang = m.lang ?? "en";
  const S = strings(lang);
  const { ref, env } = m;
  const t = ref.tractate;
  const pos = positionFor(ref);
  const label = dafLabelL(lang, t, ref.daf);
  const prev = adjacentDaf(t, ref.daf, -1);
  const next = adjacentDaf(t, ref.daf, 1);
  // Dapim before today's are "learned" in the mini map; on a permalink for a future daf nothing is filled past today.
  const learnedThrough = m.todayRef && m.todayRef.tractate.slug === t.slug ? m.todayRef.daf : m.todayRef && m.todayRef.tractate.order > t.order ? t.lastDaf + 1 : t.firstDaf;
  const prevWord = m.isToday ? S.prevWordToday : S.prevWord;
  const nextWord = m.isToday ? S.nextWordToday : S.nextWord;
  const firstText = m.texts[0]?.text;
  const dateWords = longDateL(lang, m.date);
  const shownNote = lang === "en" ? m.note : currentTranslation(m.note, m.translation ?? null);
  const description = shownNote ? S.metaDescriptionWithNote(label, dateWords, shownNote.summary) : S.metaDescription(label, dateWords);
  const headline = m.isToday ? S.headlineToday(label) : label;
  const dateLine = lang === "en"
    ? `${dateWords} <span class="sep" aria-hidden="true">·</span> ${esc(hebrewDateL("en", m.date))} <span lang="he" dir="rtl" class="he-inline">${esc(hebrewDateL("he", m.date))}</span>`
    : `${esc(hebrewDateL("he", m.date))} <span class="sep" aria-hidden="true">·</span> ${esc(dateWords)}`;
  const chs = chaptersForDaf(t, ref.daf);
  const chapterLabel = lang === "en" ? pos.chapterLabel : chs.length === 1 ? S.chapterOf(chs[0]!.n, t.chapters.length) : chs.length > 1 ? S.chaptersOf(chs[0]!.n, chs[chs.length - 1]!.n, t.chapters.length) : "";
  const chapterTitles = lang === "en" ? pos.chapterTitles : chs.map((c) => c.heTitle);

  const sections = m.texts.map((x, i) => amudSection(lang, amudLabel(lang, t, ref.daf, i, x.label), x.text, x.biur, i === 0 ? "a" : i === 1 ? "b" : `s${i + 1}`)).join("\n");
  const anyBiur = m.texts.some((x) => (x.biur?.html.length ?? 0) > 0);
  // The "show the original" toggle: English pages always have the Hebrew behind it; Hebrew pages only when a biur is the primary text.
  const anyHebrew = lang === "en" ? m.texts.some((x) => x.text.he.length > 0) : anyBiur && m.texts.some((x) => x.text.he.length > 0);
  const anyElu = lang === "en" ? m.texts.some((x) => x.text.enHtml.some((s) => s.includes('class="elu"'))) : m.texts.some((x) => (x.biur?.html ?? []).some((s) => s.includes('class="elu"')));
  const toggle = (name: string, labels: [string, string], extra = "") =>
    `<button type="button" class="toggle${extra}" data-toggle="${name}" data-off="${esc(labels[0])}" data-on="${esc(labels[1])}" aria-pressed="false">${esc(labels[0])}</button>`;
  const heTitleSpan = lang === "en" ? ` <span lang="he" dir="rtl" class="he-title">${esc(t.heTitle)}</span>` : "";
  const legend = lang !== "en" && !anyBiur ? `<p class="legend muted">${esc(S.noBiurNotice)}</p>` : `<p class="legend muted">${S.legend}</p>`;

  // English pages only, once the newsletter is public; the box needs the Turnstile site key to be worth showing.
  const subscribeBox = lang === "en" && env.NEWSLETTER_PUBLIC === "1" && env.TURNSTILE_SITE_KEY
    ? renderInlineSubscribe({ siteKey: env.TURNSTILE_SITE_KEY, defaultTz: env.DEFAULT_TIMEZONE || "America/New_York", hasNote: Boolean(shownNote) })
    : null;

  const body = `
<article class="daf">
  <header class="daf-head">
    <p class="date">${dateLine}</p>
    <h1>${esc(headline)}${heTitleSpan}</h1>
    ${renderPositionMini(ref, learnedThrough, lang)}
    ${positionStripL(lang, pos, chapterLabel, chapterTitles)}
    <p class="cycle muted">${esc(S.cycleLine(pos.cycle, longDateL(lang, pos.cycleEnd), pos.percentThroughCycle))}</p>
  </header>

  ${noteBox(m, lang)}
  ${subscribeBox ?? ""}

  <p class="ornament" aria-hidden="true">✦</p>

  <div class="tools" role="group" aria-label="${esc(S.toolsAria)}">
    ${anyHebrew ? toggle("he", S.toggleHe) : ""}
    ${anyElu ? toggle("talmudOnly", S.toggleTalmudOnly) : ""}
    ${toggle("text", S.toggleText, " toggle-text")}
    ${legend}
  </div>

  ${sections}

  <nav class="prevnext" aria-label="${esc(S.neighboursAria)}">
    ${prev ? `<a rel="prev" href="${p(lang, dafPath(prev.tractate, prev.daf))}"><span class="muted small">${esc(prevWord)}</span><br>${S.arrowPrev} ${esc(dafLabelL(lang, prev.tractate, prev.daf))}</a>` : "<span></span>"}
    <a href="${p(lang, `/${esc(t.slug)}`)}"><span class="muted small">${esc(S.theTractate)}</span><br>${esc(S.allOf(tractateName(lang, t)))}</a>
    ${next ? `<a rel="next" href="${p(lang, dafPath(next.tractate, next.daf))}" class="right"><span class="muted small">${esc(nextWord)}</span><br>${esc(dafLabelL(lang, next.tractate, next.daf))} ${S.arrowNext}</a>` : "<span></span>"}
  </nav>

  <section class="deeper-wrap">
    <h2>${esc(S.goDeeper)}</h2>
    <p class="muted">${esc(S.teachersLine)}</p>
    ${scholarLinks(t, ref.daf, firstText?.urlRef, lang, m.isToday || m.date.getTime() < Date.now())}
  </section>
</article>${subscribeBox ? INLINE_SUBSCRIBE_TAIL : ""}`;

  const canonicalPath = m.isToday ? "/" : dafPath(t, ref.daf);
  const url = `${m.origin}${p(lang, canonicalPath)}`;
  // The per-daf share card, when one exists for the note shown here; otherwise the static card (src/og/store.ts).
  const cardUrl = lang === "en" && m.card && shownNote ? `${m.origin}${cardPath(t, ref.daf, m.card.token)}` : null;
  const ogImage = cardUrl ?? `${m.origin}${lang === "he" ? "/og-he.png" : "/og.png"}`;
  const jsonLd: unknown[] = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: m.isToday ? S.ldHeadlineToday(label) : S.ldHeadline(label),
      description: plainText(description).slice(0, 300),
      datePublished: ymd(m.date),
      dateModified: shownNote?.generatedAt ?? m.note?.generatedAt ?? ymd(m.date),
      inLanguage: lang,
      isAccessibleForFree: true,
      url,
      mainEntityOfPage: url,
      image: ogImage,
      author: { "@type": "Person", name: "Joe Eichenbaum", url: `${m.origin}${p(lang, "/about")}` },
      publisher: { "@type": "Organization", name: env.SITE_NAME, url: `${m.origin}/`, logo: { "@type": "ImageObject", url: `${m.origin}/og.png` } },
      about: { "@type": "CreativeWork", name: `${t.sefariaTitle} ${ref.daf}`, alternateName: t.heTitle, isPartOf: { "@type": "CreativeWork", name: "Babylonian Talmud" } },
      isBasedOn: { "@type": "CreativeWork", name: "The William Davidson Talmud", url: "https://www.sefaria.org/william-davidson-talmud", license: "https://creativecommons.org/licenses/by-nc/4.0/" },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: env.SITE_NAME, item: `${m.origin}${p(lang, "/")}` },
        { "@type": "ListItem", position: 2, name: S.breadcrumbTractates, item: `${m.origin}${p(lang, "/tractates")}` },
        { "@type": "ListItem", position: 3, name: tractateName(lang, t), item: `${m.origin}${p(lang, `/${t.slug}`)}` },
        { "@type": "ListItem", position: 4, name: label, item: `${m.origin}${p(lang, dafPath(t, ref.daf))}` },
      ],
    },
  ];
  if (m.isToday) jsonLd.push({ "@context": "https://schema.org", "@type": "WebSite", name: env.SITE_NAME, alternateName: "Daf Yomi Dot Dev", url: `${m.origin}${p(lang, "/")}`, description: env.SITE_TAGLINE, inLanguage: lang });
  return page({
    env,
    origin: m.origin,
    lang,
    title: m.isToday ? S.titleToday(label) : S.titlePermalink(label),
    description: plainText(description).slice(0, 300),
    canonicalPath,
    body,
    bodyClass: "daf-page",
    extraHead: subscribeBox ? INLINE_SUBSCRIBE_HEAD : undefined,
    ogType: "article",
    ogImage,
    ogImageAlt: cardUrl && shownNote ? shownNote.summary : undefined,
    jsonLd,
  });
}
