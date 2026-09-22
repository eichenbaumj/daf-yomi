/**
 * Every user-facing string in the site chrome, per language. English is the
 * source of truth and is moved here verbatim from the renderers; Hebrew is a
 * first draft for the reviewer round (see he.ts). Yiddish arrives on the same
 * table. Note text is never here: notes come from KV (src/note), translated by
 * src/note/translate.ts.
 *
 * Rules (test/i18n.test.ts checks them): no em dashes anywhere; every key
 * present in every enabled language; Hebrew values carry no Latin letters
 * except a short allowlist (AI, RSS, Pre-Release, the wordmark, URLs).
 */
import type { MapKind } from "../map/kinds";

export type Lang = "en" | "he" | "yi";
/** Languages the router accepts as a path prefix. Yiddish joins when its strings exist. */
export const ENABLED_LANGS: readonly Lang[] = ["en", "he"];
export const isLang = (x: string): x is Lang => (ENABLED_LANGS as readonly string[]).includes(x);
export const dirOf = (lang: Lang): "ltr" | "rtl" => (lang === "en" ? "ltr" : "rtl");

/** Path for a page in a language: "/" stays "/", others get the prefix ("/he", "/he/bekhorot/2"). */
export function p(lang: Lang, path: string): string {
  if (lang === "en") return path;
  return path === "/" ? `/${lang}` : `/${lang}${path}`;
}

export interface Strings {
  lang: Lang;
  /** Language switch. */
  langSwitchAria: string;
  langName: Record<Lang, string>;
  preReleaseTag: string;
  /** One line under the header on every page of a pre-release language; `englishHref` links the same page in English. */
  preReleaseNotice: (englishHref: string) => string;

  // ---- layout ----
  skipToText: string;
  homeAria: (siteName: string) => string;
  navToday: string;
  navTractates: string;
  navAbout: string;
  navFeed: string;
  navFeedTitle: string;
  navNewsletter: string;
  ogImageAlt: (siteName: string) => string;
  /** Footer attribution paragraph, HTML. */
  footerAttribution: string;
  /** Footer second paragraph, HTML; `aboutHref` and `newsletterHref` are already language-prefixed. */
  footerNote: (aboutHref: string, newsletterPublic: boolean, newsletterHref: string) => string;

  // ---- daf page ----
  aiBadge: string;
  aiLabel: string;
  /** HTML. */
  legend: string;
  notesOff: string;
  notePendingNear: string;
  notePendingFar: string;
  /** HTML; shown in a translated language when the note exists in English but its translation does not. */
  translationPending: (englishHref: string) => string;
  creditEnglish: (versionTitle: string, license: string) => string;
  creditHebrew: (versionTitle: string, license: string) => string;
  creditBiur: (versionTitle: string, license: string) => string;
  openOnSefaria: string;
  segmentAria: (n: number) => string;
  noTextForSegment: string;
  /** Kinnim/Middot in Hebrew: there is no Steinsaltz biur for the Mishnah days. */
  noBiurNotice: string;
  hadranBlurb: string;
  mjlBlurb: string;
  kollelBlurb: string;
  steinsaltzCenterBlurb: string;
  sefariaBlurb: string;
  prevWordToday: string;
  prevWord: string;
  nextWordToday: string;
  nextWord: string;
  arrowPrev: string;
  arrowNext: string;
  metaDescriptionWithNote: (label: string, dateWords: string, summary: string) => string;
  metaDescription: (label: string, dateWords: string) => string;
  headlineToday: (label: string) => string;
  cycleLine: (cycle: number, endDate: string, percent: number) => string;
  toolsAria: string;
  toggleHe: [off: string, on: string];
  toggleTalmudOnly: [off: string, on: string];
  toggleText: [off: string, on: string];
  neighboursAria: string;
  theTractate: string;
  allOf: (name: string) => string;
  goDeeper: string;
  teachersLine: string;
  titleToday: (label: string) => string;
  titlePermalink: (label: string) => string;
  ldHeadlineToday: (label: string) => string;
  ldHeadline: (label: string) => string;
  breadcrumbTractates: string;
  chapterOf: (n: number, total: number) => string;
  chaptersOf: (a: number, b: number, total: number) => string;
  /** "Share this note": the button under the AI note, which copies the permalink only; `shareDone` replaces its label
   *  for two seconds after a copy. */
  shareNote: string;
  shareDone: string;

  // ---- the map of the page (src/render/pageMap.ts; drawn by src/map) ----
  mapHeading: string;
  mapAiBadge: string;
  /** The AI sentence above the map's words, every time. */
  mapAiLabel: string;
  /** The label of each kind of unit, e.g. "A question". */
  mapKind: Record<MapKind, string>;
  /** One clause per kind for the legend under the map, English only; a language whose readers know the terms leaves every gloss "". */
  mapKindGloss: Record<MapKind, string>;
  /** "3 of 6". */
  mapUnitOf: (n: number, total: number) => string;
  /** The running head: "3 of 6 · An objection: But the ox is different". */
  mapHead: (of: string, kind: string, title: string) => string;
  hereBarAria: string;
  hereBackTitle: string;
  /** "Yesterday: Bekhorot 3", the aria label of a page turn in the running head. */
  turnAria: (word: string, label: string) => string;

  // ---- social card (src/og/card.ts; the image behind a shared link) ----
  cardWordmark: string;
  cardAiChip: string;
  cardAiLine: string;

  // ---- position bar ----
  capTalmud: string;
  dayOf: (day: string, total: string) => string;
  tractateOf: (i: number, n: number) => string;
  dafOf: (daf: string, last: string) => string;
  zoomAria: (day: string, total: string, seder: string, tractate: string, i: number, n: number, daf: string, last: string) => string;
  zoomHintIn: string;
  zoomHintOut: string;

  // ---- About-page diagram ----
  /** Plain gloss per Seder, canonical order. */
  sederGloss: [string, string, string, string, string, string];
  yearsMonths: (years: number, months: number) => string;
  diagramCaption: string;
  statDafADay: string;
  statDapim: string;
  statToRead: string;
  dafSvgAria: string;
  /** HTML paragraph. */
  dafExplainer: string;
  ordersLabel: string;
  ordersAria: string;
  tractatesLabel: (n: number) => string;
  tractateAria: (name: string, days: number) => string;
  youAreHere: (day: string, label: string) => string;
  cycleCaption: (cycle: number, start: string, end: string) => string;
  legendCount: (tractates: number, days: number) => string;
  diagramFootnote: (start: string, end: string) => string;

  // ---- tractate page ----
  introSummary: (name: string) => string;
  onSefaria: string;
  daysN: (n: number) => string;
  dapimRange: (a: number, b: number) => string;
  dateRangeCycle: (start: string, end: string, cycle: number) => string;
  sefariaDescription: string;
  chaptersHeading: string;
  everyDafHeading: string;
  datesNote: (cycle: number) => string;
  hasNote: string;
  allTractates: string;
  neighbourTractatesAria: string;
  tractateTitle: (name: string) => string;
  tractateDescription: (name: string, heTitle: string, days: number, shortDesc: string) => string;

  // ---- tractates index ----
  otherSeder: string;
  daysAndRange: (n: number, start: string, end: string) => string;
  now: string;
  tractatesHeading: string;
  tractatesLede: (cycle: number) => string;
  tractatesTitle: string;
  tractatesMetaDescription: string;

  // ---- 404 / error ----
  notFoundHeading: string;
  notFoundBody: (path: string) => string;
  todaysDaf: string;
  notFoundTitle: string;
  notFoundDescription: string;
  errorHeading: string;
  errorBody: string;
  errorTitle: string;
  errorDescription: string;

  // ---- feed ----
  feedAiSmall: string;
  feedNoNote: (label: string) => string;

  // ---- about ----
  aboutTitle: string;
  aboutDescription: string;
}
