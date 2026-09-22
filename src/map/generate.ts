/**
 * Draws the map of a page with Claude, checks it against the page it was given (src/map/gate.ts), and stores it.
 * Two drafts at most, the second with the gate's feedback; then give up (a page without a map shows no map, never
 * an ungrounded one). Never called from a page visit: the cron draws the near days, scripts/maps-backfill.ts the
 * rest. No lock for the same reason (the pattern of src/note/translate.ts).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Env } from "../types";
import type { DafRef } from "../daf/schedule";
import { loadDafSections } from "../sefaria/client";
import { takeGenerationSlot } from "../note/cap";
import { estimateUsd, positionLine } from "../note/generate";
import { cueSegments, sectionsFrom, sourceTextOf } from "./cues";
import { checkMap } from "./gate";
import { hashMapPrompt, MAP_SYSTEM, MapSchema, mapUserMessage, type MapDraft, type MapPromptInput } from "./prompt";
import { getMap, putMap, type DafMap } from "./store";

export type MapOutcome =
  | { status: "exists"; map: DafMap }
  | { status: "generated"; map: DafMap; attempts: number; firstAttemptProblems?: string[] }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; problems?: string[]; lastDraft?: MapDraft };

export interface MapDraftResult { draft: MapDraft | null; refusal?: string; usage: { inputTokens: number; outputTokens: number } }
/** The paid and network-bound steps, replaceable in tests (the pattern of src/note/generate.ts `GenerateDeps`). */
export interface MapDeps {
  draft?: (input: MapPromptInput) => Promise<MapDraftResult>;
  buildInput?: typeof buildMapInput;
}
export interface MapOpts { force?: boolean; countAgainstCap?: boolean }

/** The page as the map sees it: every segment numbered the way the rendered page numbers it, plus the marks. Exported for scripts. */
export async function buildMapInput(ref: DafRef, kv?: KVNamespace): Promise<{ input: MapPromptInput; sources: string[]; sourceText: string }> {
  const loaded = await loadDafSections(ref.tractate, ref.daf, ref.cycle, kv);
  const sections = sectionsFrom(loaded);
  return {
    input: { label: `${ref.tractate.name} ${ref.daf}`, positionLine: positionLine(ref), sections, cues: cueSegments(sections) },
    sources: loaded.map((x) => x.text.urlRef),
    sourceText: sourceTextOf(sections),
  };
}

/** A twelve-unit map is about 800 tokens of JSON; the longest pages (73 segments) stay well inside this. */
export const MAP_MAX_TOKENS = 2500;

/** The request body for one draft, shared by the live path and the Batch API scripts. */
export function mapRequest(model: string, input: MapPromptInput) {
  return {
    model,
    max_tokens: MAP_MAX_TOKENS,
    system: MAP_SYSTEM,
    messages: [{ role: "user" as const, content: mapUserMessage(input) }],
    output_config: { format: zodOutputFormat(MapSchema) },
  };
}

export async function draftMap(client: Anthropic, model: string, input: MapPromptInput): Promise<MapDraftResult> {
  const response = await client.messages.parse(mapRequest(model, input));
  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  if (response.stop_reason === "refusal") return { draft: null, refusal: response.stop_details?.explanation ?? "model declined", usage };
  return { draft: response.parsed_output ?? null, usage };
}

/** Draw (or fetch) the map for a daf. `force` re-draws even if one exists. */
export async function ensureMap(env: Env, ref: DafRef, opts: MapOpts = {}, deps: MapDeps = {}): Promise<MapOutcome> {
  const { tractate: t, daf } = ref;
  if (!opts.force) {
    const existing = await getMap(env.DAF_KV, t, daf);
    if (existing) return { status: "exists", map: existing };
  }
  if (!env.ANTHROPIC_API_KEY && !deps.draft) return { status: "skipped", reason: "ANTHROPIC_API_KEY is not set" };
  if (!opts.force || opts.countAgainstCap) {
    const slot = await takeGenerationSlot(env);
    if (!slot.ok) return { status: "skipped", reason: slot.reason };
  }
  const { input, sources, sourceText } = await (deps.buildInput ?? buildMapInput)(ref, env.DAF_KV);
  if (sourceText.replace(/\s+/g, " ").length < 200) return { status: "failed", reason: "source text too short to map" };
  const model = env.NOTE_MODEL || "claude-opus-5";
  const client = deps.draft ? null : new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  const draft = deps.draft ?? ((i: MapPromptInput) => draftMap(client!, model, i));
  let feedback: string | undefined;
  let inputTokens = 0, outputTokens = 0;
  let firstAttemptProblems: string[] | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { draft: d, refusal, usage } = await draft({ ...input, feedback });
    inputTokens += usage.inputTokens; outputTokens += usage.outputTokens;
    if (!d) return { status: "failed", reason: refusal ? `refused: ${refusal}` : "unparseable response" };
    const check = checkMap(d, input, sourceText);
    if (check.ok) {
      const map: DafMap = {
        ...d, model, promptVersion: hashMapPrompt(), generatedAt: new Date().toISOString(), sources,
        segmentCounts: input.sections.map((s) => s.segments.length),
        usage: { inputTokens, outputTokens, attempts: attempt, estUsd: estimateUsd(model, inputTokens, outputTokens) },
      };
      await putMap(env.DAF_KV, t, daf, map);
      return { status: "generated", map, attempts: attempt, firstAttemptProblems };
    }
    firstAttemptProblems ??= check.problems;
    console.log(`[map] ${t.slug}/${daf} attempt ${attempt} rejected: ${check.problems.join(" | ")}`);
    feedback = check.problems.join(" ");
    if (attempt === 2) return { status: "failed", reason: "map failed the gate twice", problems: check.problems, lastDraft: d };
  }
  return { status: "failed", reason: "unreachable" };
}
