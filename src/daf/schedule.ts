/**
 * Date ↔ daf, computed offline with @hebcal/learning (a public-domain port of
 * daf.el). No network involved; Sefaria's calendar is only consulted by
 * scripts/verify-cycle.ts, which must agree with this module 100%.
 *
 * Convention: the daf follows the civil date in the reader's timezone, the
 * same convention Sefaria and Hebcal use. (The halachic day begins at
 * nightfall; no published Daf Yomi calendar keys by it.)
 */
import { HDate } from "@hebcal/core";
import { DafYomi } from "@hebcal/learning";
import { CYCLE_LENGTH, TRACTATES, tractateByHebcalName, type Tractate } from "./tractates";

/** Cycle 8 began 24 June 1975; every cycle since is exactly CYCLE_LENGTH days. */
const CYCLE_8_START_ABS = new HDate(new Date(1975, 5, 24)).abs();

export interface DafRef {
  tractate: Tractate;
  daf: number;
  cycle: number;
  /** 1-based day within the cycle (1 … 2711). */
  dayInCycle: number;
}

export function cycleStartAbs(cycle: number): number {
  return CYCLE_8_START_ABS + (cycle - 8) * CYCLE_LENGTH;
}
export function cycleStartDate(cycle: number): Date {
  return new HDate(cycleStartAbs(cycle)).greg();
}
export function cycleEndDate(cycle: number): Date {
  return new HDate(cycleStartAbs(cycle) + CYCLE_LENGTH - 1).greg();
}

/** The daf learned on a civil date (local-midnight Date; only y/m/d are read). */
export function dafForDate(date: Date): DafRef {
  const dy = new DafYomi(date);
  const cycle: number = (dy as unknown as { cycle: number }).cycle;
  const abs = new HDate(date).abs();
  return {
    tractate: tractateByHebcalName(dy.getName()),
    daf: Number(dy.getBlatt()),
    cycle,
    dayInCycle: abs - cycleStartAbs(cycle) + 1,
  };
}

const PREFIX_DAYS: number[] = TRACTATES.reduce<number[]>((acc, t, i) => { acc.push(i === 0 ? 0 : acc[i - 1]! + TRACTATES[i - 1]!.days); return acc; }, []);

/** Days from the start of a cycle to a given daf (0-based). */
export function cycleOffset(t: Tractate, daf: number): number {
  return PREFIX_DAYS[t.order]! + (daf - t.firstDaf);
}

/** The civil date a daf is learned in a given cycle. */
export function dateForDaf(t: Tractate, daf: number, cycle: number): Date {
  return new HDate(cycleStartAbs(cycle) + cycleOffset(t, daf)).greg();
}

/** Neighbouring dapim across tractate boundaries; null at the ends of the cycle. */
export function adjacentDaf(t: Tractate, daf: number, delta: 1 | -1): { tractate: Tractate; daf: number } | null {
  if (delta === 1) {
    if (daf < t.lastDaf) return { tractate: t, daf: daf + 1 };
    const next = TRACTATES[t.order + 1];
    return next ? { tractate: next, daf: next.firstDaf } : null;
  }
  if (daf > t.firstDaf) return { tractate: t, daf: daf - 1 };
  const prev = TRACTATES[t.order - 1];
  return prev ? { tractate: prev, daf: prev.lastDaf } : null;
}

// Intl.DateTimeFormat construction costs real CPU (Workers bill CPU per invocation), so build each formatter once.
const ymdFormatters = new Map<string, Intl.DateTimeFormat>();
function ymdFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = ymdFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    ymdFormatters.set(timeZone, f);
  }
  return f;
}
const LONG_DATE = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const SHORT_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Today's civil date in an IANA timezone, as a local-midnight Date. */
export function todayIn(timeZone: string, now: Date = new Date()): Date {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = ymdFormatter(timeZone).formatToParts(now);
  } catch {
    parts = ymdFormatter("UTC").formatToParts(now);
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(get("year"), get("month") - 1, get("day"));
}

export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** "9 Tishrei 5787" */
export function hebrewDate(d: Date): string {
  return new HDate(d).toString();
}
/** "ט׳ תִּשְׁרֵי תשפ״ז" */
export function hebrewDateHe(d: Date): string {
  return new HDate(d).renderGematriya();
}
/** "Sunday, 20 September 2026" */
export function longDate(d: Date): string {
  return LONG_DATE.format(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}
/** "20 Sep 2026" */
export function shortDate(d: Date): string {
  return SHORT_DATE.format(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}
