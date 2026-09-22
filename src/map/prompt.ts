import mapGuide from "../../prompts/daf-map.md";
import { z } from "zod";
import { fingerprint } from "../note/fingerprint";
import { MAP_KINDS } from "./kinds";
import { MARK_WORD, numberedText, type Cue, type MapSection } from "./cues";

/** Bumped by hand when the map's house style changes in a way that should re-draw the archive. */
export const MAP_PROMPT_VERSION = "2026-09-22.2";

export const MAP_SYSTEM = mapGuide.trim();

/** Every cap here is enforced again by the gate (src/map/gate.ts): the structured-output grammar may not carry them. */
export const MapSchema = z.object({
  units: z.array(z.object({
    from: z.string().describe("The id of the first segment in this unit, e.g. a-1."),
    to: z.string().describe("The id of the last segment in this unit, inclusive, e.g. a-4. A unit may run from the a side into the b side."),
    kind: z.enum(MAP_KINDS),
    title: z.string().describe("At most eight plain English words naming the concrete thing. Not the kind's name."),
    gloss: z.string().describe("One short sentence of at most 20 words: what happens in these lines, in the page's own concrete terms."),
  })).describe("Every segment in exactly one unit, in order, without gaps, from the first id to the last. Usually five to nine units, never more than twelve."),
  shape: z.string().describe("One sentence, at most 30 words, on how the whole page moves."),
});
export type MapDraft = z.infer<typeof MapSchema>;

export interface MapPromptInput {
  label: string; // "Bekhorot 4"
  positionLine: string; // "Seder Kodashim · Bekhorot · Chapter 1 of 9 · Daf 4 of 61"
  sections: MapSection[];
  cues: Cue[];
  feedback?: string; // on retry: what failed
}

export function mapUserMessage(input: MapPromptInput): string {
  const cueLine = input.cues.length
    ? `The text's own marks say a new unit begins at these segments, so each of them must be the "from" of a unit: ${input.cues.map((c) => `${c.id} (${MARK_WORD[c.mark]})`).join(", ")}. A unit that begins at a MISHNA mark has the kind mishna.`
    : `The text carries no section marks on this page; divide it yourself, where the argument turns.`;
  const parts = [
    `Today's page: ${input.label}. Position: ${input.positionLine}.`,
    `Below is the complete English text of the page, one numbered segment at a time. The id in brackets is the segment's id, and your units refer to these ids. Bold in the original marks the Talmud's own words; the rest is the translator's explanation, rendered here as plain text. It is your only source.`,
    numberedText(input.sections),
    cueLine,
    `Map ${input.label} as the guide says. Return only the structured fields.`,
  ];
  if (input.feedback) parts.push(`Your previous attempt was rejected: ${input.feedback} Fix that and try again.`);
  return parts.join("\n\n");
}

export function hashMapPrompt(): string {
  return fingerprint(MAP_PROMPT_VERSION, MAP_SYSTEM);
}
