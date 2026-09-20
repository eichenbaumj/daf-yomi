import { CYCLE_LENGTH, type Chapter, type Tractate } from "./tractates";
import { cycleEndDate, type DafRef } from "./schedule";

function amudIndex(ref: string): number {
  const m = /^(\d+)([ab])$/.exec(ref);
  if (!m) return Number.NaN;
  return Number(m[1]) * 2 + (m[2] === "b" ? 1 : 0);
}

/** Chapters that touch either side of this daf (a chapter can end and the next begin on one daf). */
export function chaptersForDaf(t: Tractate, daf: number): Chapter[] {
  const a = daf * 2;
  const b = daf * 2 + 1;
  return t.chapters.filter((c) => {
    const s = amudIndex(c.startDaf);
    const e = amudIndex(c.endDaf);
    return !(e < a || s > b);
  });
}

export interface Position {
  seder: string;
  sederHe: string;
  tractate: string;
  tractateHe: string;
  /** "Chapter 1 of 9", "Chapters 1–2 of 9", or "" when unknown. */
  chapterLabel: string;
  chapterTitles: string[];
  daf: number;
  dafOfTractate: string;
  dayInCycle: number;
  cycleLength: number;
  cycle: number;
  cycleEnd: Date;
  percentThroughCycle: number;
}

export function positionFor(ref: DafRef): Position {
  const { tractate: t, daf, cycle, dayInCycle } = ref;
  const chs = chaptersForDaf(t, daf);
  let chapterLabel = "";
  if (chs.length === 1) chapterLabel = `Chapter ${chs[0]!.n} of ${t.chapters.length}`;
  else if (chs.length > 1) chapterLabel = `Chapters ${chs[0]!.n}–${chs[chs.length - 1]!.n} of ${t.chapters.length}`;
  return {
    seder: t.seder,
    sederHe: t.sederHe,
    tractate: t.name,
    tractateHe: t.heTitle,
    chapterLabel,
    chapterTitles: chs.map((c) => c.title),
    daf,
    dafOfTractate: `Daf ${daf} of ${t.lastDaf}`,
    dayInCycle,
    cycleLength: CYCLE_LENGTH,
    cycle,
    cycleEnd: cycleEndDate(cycle),
    percentThroughCycle: Math.round((dayInCycle / CYCLE_LENGTH) * 1000) / 10,
  };
}
