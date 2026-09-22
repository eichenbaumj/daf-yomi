/**
 * Code-enforced guardrails for the map. The prompt asks; this checks: the units chain over every segment of the
 * page, the text's own marks begin units, kinds come from the vocabulary, and every string obeys the note's rules
 * (src/note/grounding.ts, reused rather than copied).
 */
import { articleSlips, BANNED_PHRASES, BANNED_WORDS, danglingLegalVerbs, LATER_AUTHORITIES, normalize, quotedSpans, sagesNotOnPage, unglossed, wordCount, type GroundingResult } from "../note/grounding";
import { isMapKind, MAP_KINDS } from "./kinds";
import { MARK_WORD, segmentIds, type Cue, type MapSection } from "./cues";
import type { MapDraft } from "./prompt";

/**
 * The prompt asks for at most twelve units, eight-word titles, twenty-word glosses and a thirty-word shape (Joe,
 * 2026-09-22: a reader should be into the text within half a minute); the gate allows a little past each, because
 * the model's count is loose by a word or two and a second draft costs as much as the first.
 */
export const MAX_UNITS = 14;
export const MAX_TITLE_WORDS = 10;
export const MAX_GLOSS_WORDS = 24;
export const MAX_SHAPE_WORDS = 34;

/** A title that is only the kind's name ("Question", "The dispute", "Left open") names nothing. */
const KIND_NAMES = new Set<string>([...MAP_KINDS, "left open"]);
const MORE_THAN_ONE_SENTENCE = /[.!?]\s+["“]?[A-Z]/;

export interface MapPage { sections: MapSection[]; cues: Cue[] }

export function checkMap(draft: MapDraft, page: MapPage, sourceText: string): GroundingResult {
  const problems: string[] = [];
  const src = normalize(sourceText);
  const ids = segmentIds(page.sections);
  const index = new Map(ids.map((id, i) => [id, i] as const));
  const units = draft.units;

  // 1. Structure: known ids, in order, contiguous, covering the page.
  if (units.length === 0) problems.push("the map has no units.");
  if (units.length > MAX_UNITS) problems.push(`too many units (${units.length}); a unit is a move of the argument, not a segment.`);
  let expected = 0;
  let chained = units.length > 0;
  units.forEach((u, i) => {
    const f = index.get(u.from);
    const t = index.get(u.to);
    if (f === undefined) { problems.push(`unit ${i + 1} starts at "${u.from}", which is not a segment of this page.`); chained = false; return; }
    if (t === undefined) { problems.push(`unit ${i + 1} ends at "${u.to}", which is not a segment of this page.`); chained = false; return; }
    if (t < f) { problems.push(`unit ${i + 1} ends at ${u.to}, before it starts at ${u.from}.`); chained = false; return; }
    if (chained && f !== expected) {
      if (i === 0) problems.push(`the first unit must start at ${ids[0]}, not ${u.from}.`);
      else if (f > expected) problems.push(`gap: segments ${ids[expected]} to ${ids[f - 1]} belong to no unit; units must run without gaps.`);
      else problems.push(`overlap: unit ${i + 1} starts at ${u.from}, but the unit before it already runs through ${ids[expected - 1]}.`);
      chained = false;
    }
    expected = t + 1;
  });
  if (chained && expected !== ids.length) problems.push(`the last unit ends at ${units[units.length - 1]!.to}; the page runs to ${ids[ids.length - 1]}.`);

  // 2. The text's own marks begin units.
  const byFrom = new Map(units.map((u) => [u.from, u] as const));
  for (const c of page.cues) {
    const u = byFrom.get(c.id);
    if (!u) problems.push(`segment ${c.id} carries a ${MARK_WORD[c.mark]} mark and must begin a unit.`);
    else if (c.mark === "mishna" && u.kind !== "mishna") problems.push(`the unit at ${c.id} begins at MISHNA: and must be of kind mishna, not ${u.kind}.`);
  }

  // 3. Kinds (the put endpoint receives untrusted bodies; zod guards the live path).
  units.forEach((u, i) => { if (!isMapKind(u.kind)) problems.push(`unit ${i + 1} has kind "${u.kind}", which is not one of: ${MAP_KINDS.join(", ")}.`); });

  // 4. Caps.
  const titles = new Set<string>();
  units.forEach((u, i) => {
    const tw = wordCount(u.title);
    if (tw < 1 || tw > MAX_TITLE_WORDS) problems.push(`unit ${i + 1}'s title is ${tw} words; at most ${MAX_TITLE_WORDS}.`);
    const gw = wordCount(u.gloss);
    if (gw < 4 || gw > MAX_GLOSS_WORDS) problems.push(`unit ${i + 1}'s gloss is ${gw} words; one sentence of at most ${MAX_GLOSS_WORDS}.`);
    if (MORE_THAN_ONE_SENTENCE.test(u.gloss.trim())) problems.push(`unit ${i + 1}'s gloss is more than one sentence.`);
    const bare = normalize(u.title).replace(/^(a|an|the) /, "");
    if (KIND_NAMES.has(bare)) problems.push(`unit ${i + 1}'s title is only the kind's name ("${u.title}"); name the concrete thing.`);
    if (titles.has(bare)) problems.push(`the title "${u.title}" is used twice.`);
    titles.add(bare);
  });
  const sw = wordCount(draft.shape);
  if (sw < 8 || sw > MAX_SHAPE_WORDS) problems.push(`the shape sentence is ${sw} words; one sentence of 8 to ${MAX_SHAPE_WORDS}.`);
  if (MORE_THAN_ONE_SENTENCE.test(draft.shape.trim())) problems.push("the shape is more than one sentence.");
  if (/^(in this daf|this page|today's page|on this daf)/i.test(draft.shape.trim())) problems.push("do not open the shape with 'This page' or 'In this daf'.");

  // 5. The note's rules, per unit so the feedback names the line to fix (the second draft of the first live map
  // fixed thirteen problems and left two it could not place), then over the whole map for what is map-wide.
  const where = (i: number) => (i < units.length ? `unit ${i + 1}` : "the shape");
  const pieces = [...units.map((u) => `${u.title} ${u.gloss}`), draft.shape];
  pieces.forEach((text, i) => {
    const at = where(i);
    if (/[—]/.test(text)) problems.push(`${at}: no em dashes.`);
    const lower = text.toLowerCase();
    for (const w of BANNED_WORDS) if (new RegExp(`\\b${w}\\w*`, "i").test(text)) problems.push(`${at}: banned word: ${w}.`);
    for (const p of BANNED_PHRASES) if (lower.includes(p)) problems.push(`${at}: banned phrase: "${p.trim()}".`);
    if (LATER_AUTHORITIES.test(text)) problems.push(`${at}: do not cite later authorities, Steinsaltz, or Sefaria.`);
    for (const name of sagesNotOnPage(text, sourceText)) problems.push(`${at}: "${name}" is not named on this page; name a sage only for a view the text attributes to them, in the page's own spelling.`);
    for (const slip of articleSlips(text)) problems.push(`${at}: article does not agree with the next word: "${slip}".`);
    for (const d of danglingLegalVerbs(text)) problems.push(`${at}: legal verb left hanging, "${d}" Say it in full: exempt from the firstborn law, liable to bring an offering.`);
    for (const span of quotedSpans(text)) if (!src.includes(normalize(span))) problems.push(`${at}: quoted phrase not found in the text: "${span}".`);
  });
  // A term glossed once anywhere in the map is glossed; the report names the first unit that uses it bare.
  const prose = pieces.join(" ");
  for (const term of unglossed(prose)) {
    const first = pieces.findIndex((t) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(t));
    problems.push(`${where(first < 0 ? 0 : first)}: gloss "${term}" in a few words the first time it appears in the map ("five sela, silver coins"); the reader has never opened a Talmud.`);
  }

  return { ok: problems.length === 0, problems };
}
