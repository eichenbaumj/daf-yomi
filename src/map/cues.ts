/**
 * The page as the map sees it: every segment numbered the way the rendered page numbers it (src/render/dafPage.ts
 * emits one <li id="a-N"> per index up to max(en, he), with a placeholder for a segment that has no English), and
 * the structural marks the William Davidson text already carries.
 *
 * The marks, counted over the whole cycle (2026-09-22): "§" opens a segment where the Koren editors begin a new
 * passage (6,339 segments, never mid-segment); "MISHNA:" and "GEMARA:" label where the mishna and its discussion
 * begin (nine of them are glued to the middle of a segment, Rabbi Steinsaltz's chapter introduction sharing the
 * segment, so the label is looked for anywhere in the segment); Guggenheimer's Yerushalmi days use "MISHNAH:" and
 * "HALAKHAH:". About 290 dapim, mostly older Koren volumes, carry no mark at all; there the model divides alone.
 */
import type { DafSection } from "../sefaria/client";

export interface MapSegment { id: string; text: string }
export interface MapSection { label: string; anchor: string; segments: MapSegment[] }
export type CueMark = "mishna" | "gemara" | "halakha" | "sugya";
export interface Cue { id: string; mark: CueMark }

/** The anchor the page gives each amud: "a", "b", then "s3", "s4" for the rare third section. */
export function sectionAnchor(i: number): string {
  return i === 0 ? "a" : i === 1 ? "b" : `s${i + 1}`;
}

export function sectionsFrom(loaded: Pick<DafSection, "label" | "text">[]): MapSection[] {
  return loaded.map((x, i) => {
    const anchor = sectionAnchor(i);
    const n = Math.max(x.text.en.length, x.text.he.length);
    const segments: MapSegment[] = [];
    for (let j = 0; j < n; j++) segments.push({ id: `${anchor}-${j + 1}`, text: (x.text.enPlain[j] ?? "").trim() });
    return { label: x.label, anchor, segments };
  });
}

const SUGYA = /^\s*§/;
const MISHNA = /\bMISHNAH?:/;
const GEMARA = /\bGEMARA:/;
const HALAKHA = /\bHALAKHAH:/;

/** The word the prompt and the gate use for a mark. */
export const MARK_WORD: Record<CueMark, string> = { sugya: "§", mishna: "MISHNA", gemara: "GEMARA", halakha: "HALAKHAH" };

/** Segments that must begin a unit, in page order; one cue per segment, the mishna label winning over the rest. */
export function cueSegments(sections: MapSection[]): Cue[] {
  const out: Cue[] = [];
  for (const s of sections) {
    for (const seg of s.segments) {
      const mark: CueMark | null = MISHNA.test(seg.text) ? "mishna" : GEMARA.test(seg.text) ? "gemara" : HALAKHA.test(seg.text) ? "halakha" : SUGYA.test(seg.text) ? "sugya" : null;
      if (mark) out.push({ id: seg.id, mark });
    }
  }
  return out;
}

export const EMPTY_SEGMENT = "(no English text for this segment)";

/** The prompt body: each amud under its label, each segment on its own line behind its id. */
export function numberedText(sections: MapSection[]): string {
  return sections.map((s) => `### ${s.label}\n\n${s.segments.map((g) => `[${g.id}] ${g.text || EMPTY_SEGMENT}`).join("\n\n")}`).join("\n\n");
}

export function segmentIds(sections: MapSection[]): string[] {
  return sections.flatMap((s) => s.segments.map((g) => g.id));
}

/** The corpus quotes are checked against: the English of every segment that has any. */
export function sourceTextOf(sections: MapSection[]): string {
  return sections.flatMap((s) => s.segments.map((g) => g.text)).filter(Boolean).join("\n\n");
}
