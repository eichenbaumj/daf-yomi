/**
 * Language-aware labels and dates. English keeps the exact output the site has
 * always had (src/daf/schedule.ts); Hebrew uses the he-IL locale for civil
 * dates and gematriya for daf numbers ("בכורות ב׳").
 */
import { HDate, gematriya } from "@hebcal/core";
import type { Tractate } from "../daf/tractates";
import { hebrewDate, longDate, shortDate } from "../daf/schedule";
import { en } from "./en";
import { he } from "./he";
import type { Lang, Strings } from "./strings";

export function strings(lang: Lang): Strings {
  return lang === "he" ? he : en;
}

// Intl.DateTimeFormat construction costs CPU on Workers; build each formatter once.
const LONG_DATE_HE = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const SHORT_DATE_HE = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const utc = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

/** "Sunday, 20 September 2026" / "יום ראשון, 20 בספטמבר 2026" */
export function longDateL(lang: Lang, d: Date): string {
  return lang === "he" ? LONG_DATE_HE.format(utc(d)) : longDate(d);
}
/** "20 Sep 2026" / "20 בספט׳ 2026" */
export function shortDateL(lang: Lang, d: Date): string {
  return lang === "he" ? SHORT_DATE_HE.format(utc(d)) : shortDate(d);
}
/** English: "9 Tishrei 5787" (transliterated). Hebrew: "ט׳ תשרי תשפ״ז" (no nikud). */
export function hebrewDateL(lang: Lang, d: Date): string {
  return lang === "he" ? new HDate(d).renderGematriya(true) : hebrewDate(d);
}
/** Thousands grouping; the same digits in both languages. */
export function num(lang: Lang, n: number): string {
  return n.toLocaleString(lang === "he" ? "he-IL" : "en-US");
}
/** Daf number as shown in this language: 2 → "2" / "ב׳". */
export function dafNum(lang: Lang, daf: number): string {
  return lang === "he" ? gematriya(daf) : String(daf);
}
/** Tractate display name in this language. */
export function tractateName(lang: Lang, t: Tractate): string {
  return lang === "he" ? t.heTitle : t.name;
}
/** "Bekhorot 2" / "בכורות ב׳" */
export function dafLabelL(lang: Lang, t: Tractate, daf: number): string {
  return `${tractateName(lang, t)} ${dafNum(lang, daf)}`;
}
/** "Seder Kodashim" / "סדר קדשים"; the diagram's short form drops the word Seder in both. */
export function sederName(lang: Lang, t: Tractate): string {
  return lang === "he" ? t.sederHe : t.seder;
}
export function sederShort(lang: Lang, seder: string, sederHe: string): string {
  return lang === "he" ? sederHe.replace(/^סדר\s+/, "") : seder.replace("Seder ", "");
}
