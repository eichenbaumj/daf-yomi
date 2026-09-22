/**
 * The judge of the map: a second reading of a drawn map against the page. The gate checks structure and words; the
 * judge reads. Its verdict is derived here, in code, from the structured fields, never from the model's own verdict:
 * every complaint must point at a segment that exists and quote page words that are really there, and a gloss
 * complaint must quote the gloss it complains about. A judge that misquotes redraws nothing.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import judgeGuide from "../../prompts/daf-map-judge.md";
import { fingerprint } from "../note/fingerprint";
import { normalize } from "../note/grounding";
import { numberedText, segmentIds, type MapSection } from "./cues";
import { isMapKind, MAP_KINDS, type MapKind } from "./kinds";
import type { MapUnit } from "./store";

/** Bumped by hand when the judge's criteria change enough that old verdicts should not be trusted. */
export const MAP_JUDGE_PROMPT_VERSION = "2026-09-22.1";
export const MAP_JUDGE_SYSTEM = judgeGuide.trim();
export const MAP_JUDGE_MAX_TOKENS = 8000;

export const MapJudgeSchema = z.object({
  boundaries: z.array(z.object({
    unit: z.number().int().describe("The unit's number, counting from 1."),
    turnsAt: z.string().describe("The id of the segment where the move really turns, e.g. b-7."),
    pageSays: z.string().describe("Up to 25 words copied exactly from that segment."),
    explanation: z.string().describe("One line."),
  })),
  kinds: z.array(z.object({
    unit: z.number().int(),
    is: z.enum(MAP_KINDS).describe("The kind the page's words support."),
    pageSays: z.string().describe("Up to 25 words copied exactly from the unit's segments."),
    explanation: z.string().describe("One line."),
  })),
  glosses: z.array(z.object({
    unit: z.number().int(),
    claim: z.string().describe("Copied exactly from the unit's title or gloss."),
    pageSays: z.string().describe("Up to 25 words copied exactly from the page."),
    explanation: z.string().describe("One line."),
  })),
  shapeFits: z.boolean(),
  shapeNote: z.string().describe("When the shape does not fit: one line on what the page does that the sentence misses. Otherwise empty."),
  modelVerdict: z.enum(["keep", "redraw"]),
  feedback: z.string().describe("When redraw: two or three plain sentences on what the redrawn map must do, naming the units. Otherwise empty."),
});
export type MapJudgeRaw = z.infer<typeof MapJudgeSchema>;
export type MapVerdict = "keep" | "redraw";
export type MapReason = "boundary" | "kind" | "gloss" | "shape";

export interface MapJudgment {
  judgeVersion: string;
  /** Complaints whose segment exists and whose page words verified. */
  boundaries: { unit: number; turnsAt: string; pageSays: string; explanation: string }[];
  kinds: { unit: number; is: MapKind; was: MapKind; pageSays: string; explanation: string }[];
  glosses: { unit: number; claim: string; pageSays: string; explanation: string }[];
  shapeFits: boolean;
  shapeNote: string;
  verdict: MapVerdict;
  reasons: MapReason[];
  /** The judge pointed at words or segments that are not there; those complaints were discounted. */
  unverified: boolean;
  modelVerdict: MapVerdict;
  feedback: string;
}

export function hashMapJudgePrompt(): string {
  return fingerprint(MAP_JUDGE_PROMPT_VERSION, MAP_JUDGE_SYSTEM);
}

export interface MapJudgeInput { label: string; positionLine: string; sections: MapSection[] }

export function mapJudgeUserMessage(input: MapJudgeInput, map: { units: MapUnit[]; shape: string }): string {
  const drawn = map.units.map((u, i) => `${i + 1}. [${u.from}..${u.to}] ${u.kind}: ${u.title}. ${u.gloss}`).join("\n");
  return [
    `The page: ${input.label}. Position: ${input.positionLine}.`,
    `Below is the complete English text of the page, one numbered segment at a time, the only evidence you may cite.`,
    numberedText(input.sections),
    `THE MAP\n\nSHAPE: ${map.shape}\n\n${drawn}`,
    `Judge the map of ${input.label} as the guide says. Return only the structured fields.`,
  ].join("\n\n");
}

const onPage = (src: string, quote: string) => { const q = normalize(quote); return q.length > 0 && src.includes(q); };

/** The verdict, derived from the fields, the map and the page. Pure. */
export function verifyMapJudgment(raw: MapJudgeRaw, map: { units: MapUnit[]; shape: string }, sections: MapSection[], sourceText: string): MapJudgment {
  const src = normalize(sourceText);
  const ids = new Set(segmentIds(sections));
  const froms = new Set(map.units.map((u) => u.from));
  let unverified = false;
  const unitOk = (n: number) => Number.isInteger(n) && n >= 1 && n <= map.units.length;
  const boundaries = raw.boundaries.filter((b) => {
    // A turn at a segment that already begins a unit is not a boundary complaint; a turn at an unknown id or with
    // page words that are not there is discounted.
    const ok = unitOk(b.unit) && ids.has(b.turnsAt) && !froms.has(b.turnsAt) && onPage(src, b.pageSays);
    if (!ok) unverified = true;
    return ok;
  });
  const kinds = raw.kinds.flatMap((k) => {
    const was = unitOk(k.unit) ? map.units[k.unit - 1]!.kind : undefined;
    const ok = was !== undefined && isMapKind(k.is) && k.is !== was && onPage(src, k.pageSays);
    if (!ok) { unverified = true; return []; }
    return [{ unit: k.unit, is: k.is, was: was!, pageSays: k.pageSays, explanation: k.explanation }];
  });
  const glosses = raw.glosses.filter((g) => {
    const u = unitOk(g.unit) ? map.units[g.unit - 1]! : undefined;
    const inGloss = u ? normalize(`${u.title} ${u.gloss}`).includes(normalize(g.claim)) && normalize(g.claim).length > 0 : false;
    const ok = inGloss && onPage(src, g.pageSays);
    if (!ok) unverified = true;
    return ok;
  });
  const reasons: MapReason[] = [];
  if (boundaries.length) reasons.push("boundary");
  if (kinds.length) reasons.push("kind");
  if (glosses.length) reasons.push("gloss");
  if (!raw.shapeFits) reasons.push("shape");
  const verdict: MapVerdict = reasons.length ? "redraw" : "keep";
  const lines: string[] = [];
  for (const b of boundaries) lines.push(`Unit ${b.unit} should begin at ${b.turnsAt}, where the page says "${b.pageSays.trim()}".`);
  for (const k of kinds) lines.push(`Unit ${k.unit} is ${k.was} on the map but the page shows ${k.is}: "${k.pageSays.trim()}".`);
  for (const g of glosses) lines.push(`Unit ${g.unit} says "${g.claim.trim()}", but the page says "${g.pageSays.trim()}". Say what the page says.`);
  if (!raw.shapeFits && raw.shapeNote.trim()) lines.push(`The shape sentence misses what the page does: ${raw.shapeNote.trim()}`);
  if (verdict === "redraw" && raw.feedback.trim() && raw.modelVerdict === "redraw") lines.push(raw.feedback.trim());
  return {
    judgeVersion: hashMapJudgePrompt(),
    boundaries, kinds, glosses, shapeFits: raw.shapeFits, shapeNote: raw.shapeNote,
    verdict, reasons, unverified, modelVerdict: raw.modelVerdict,
    feedback: verdict === "redraw" ? lines.join(" ") : "",
  };
}

/** The request body for one judge call, shared by the Batch API scripts and any live use. */
export function mapJudgeRequest(model: string, input: MapJudgeInput, map: { units: MapUnit[]; shape: string }) {
  return {
    model,
    max_tokens: MAP_JUDGE_MAX_TOKENS,
    system: MAP_JUDGE_SYSTEM,
    messages: [{ role: "user" as const, content: mapJudgeUserMessage(input, map) }],
    output_config: { format: zodOutputFormat(MapJudgeSchema) },
  };
}

export async function judgeMap(client: Anthropic, model: string, input: MapJudgeInput, map: { units: MapUnit[]; shape: string }, sourceText: string): Promise<{ judgment: MapJudgment | null; refusal?: string; usage: { inputTokens: number; outputTokens: number } }> {
  const response = await client.messages.create(mapJudgeRequest(model, input, map));
  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  if (response.stop_reason === "refusal") return { judgment: null, refusal: response.stop_details?.explanation ?? "model declined", usage };
  if (response.stop_reason === "max_tokens") return { judgment: null, refusal: "verdict cut off at max_tokens", usage };
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = MapJudgeSchema.safeParse((() => { try { return JSON.parse(text); } catch { return null; } })());
  if (!parsed.success) return { judgment: null, refusal: "no structured output", usage };
  return { judgment: verifyMapJudgment(parsed.data, map, input.sections, sourceText), usage };
}
