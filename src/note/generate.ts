/**
 * Writes the day's note with Claude, checks it against the text it was given,
 * and stores it. One retry with feedback; then give up for the day (the page
 * says the note is pending rather than showing anything ungrounded).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Env } from "../types";
import type { Tractate } from "../daf/tractates";
import { positionFor } from "../daf/position";
import type { DafRef } from "../daf/schedule";
import { fetchText, resolveDafRefs } from "../sefaria/client";
import { checkNote } from "./grounding";
import { NoteSchema, SYSTEM_PROMPT, hashPrompt, userMessage, type NoteDraft, type PromptInput } from "./prompt";
import { acquireLock, getNote, putNote, releaseLock, type DafNote } from "./store";

export type GenerateOutcome =
  | { status: "exists"; note: DafNote }
  | { status: "generated"; note: DafNote; attempts: number; firstAttemptProblems?: string[] }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; problems?: string[]; lastDraft?: NoteDraft };

export function positionLine(ref: DafRef): string {
  const p = positionFor(ref);
  return [p.seder, p.tractate, p.chapterLabel, p.dafOfTractate].filter(Boolean).join(" · ");
}

/** Assemble the plain-English source for a daf. Exported for scripts. */
export async function buildPromptInput(ref: DafRef, kv?: KVNamespace): Promise<{ input: PromptInput; sources: string[]; sourceText: string }> {
  const resolved = await resolveDafRefs(ref.tractate, ref.daf, ref.cycle, kv);
  const sections: PromptInput["sections"] = [];
  for (let i = 0; i < resolved.urlRefs.length; i++) {
    const text = await fetchText(resolved.urlRefs[i]!, kv);
    const en = text.enPlain.filter(Boolean).join("\n\n");
    sections.push({ label: resolved.labels[i] ?? text.ref, text: en || "(no English text available for this section)" });
  }
  const sourceText = sections.map((s) => s.text).join("\n\n");
  return {
    input: { label: `${ref.tractate.name} ${ref.daf}`, positionLine: positionLine(ref), sections },
    sources: resolved.urlRefs,
    sourceText,
  };
}

/** List prices per million tokens, for the cost estimate stored with each note. */
const PRICE_USD_PER_M: Record<string, { input: number; output: number }> = { "claude-opus-5": { input: 5, output: 25 } };
export function estimateUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICE_USD_PER_M[model] ?? PRICE_USD_PER_M["claude-opus-5"]!;
  return Math.round(((inputTokens * p.input + outputTokens * p.output) / 1e6) * 10000) / 10000;
}

export async function draftNote(client: Anthropic, model: string, input: PromptInput): Promise<{ draft: NoteDraft | null; refusal?: string; usage: { inputTokens: number; outputTokens: number } }> {
  const response = await client.messages.parse({
    model,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage(input) }],
    output_config: { format: zodOutputFormat(NoteSchema) },
  });
  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  if (response.stop_reason === "refusal") {
    return { draft: null, refusal: response.stop_details?.explanation ?? "model declined", usage };
  }
  return { draft: response.parsed_output ?? null, usage };
}

/**
 * Generate (or fetch) the note for a daf. `force` re-bakes even if one exists.
 */
export async function ensureNote(env: Env, ref: DafRef, opts: { force?: boolean; skipLock?: boolean } = {}): Promise<GenerateOutcome> {
  const { tractate: t, daf } = ref;
  if (!opts.force) {
    const existing = await getNote(env.DAF_KV, t, daf);
    if (existing) return { status: "exists", note: existing };
  }
  if (!env.ANTHROPIC_API_KEY) return { status: "skipped", reason: "ANTHROPIC_API_KEY is not set" };
  if (!opts.skipLock && !(await acquireLock(env.DAF_KV, t, daf))) return { status: "skipped", reason: "another generation is in progress" };
  try {
    const { input, sources, sourceText } = await buildPromptInput(ref, env.DAF_KV);
    if (sourceText.replace(/\s+/g, " ").length < 200) return { status: "failed", reason: "source text too short to write from" };
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
    const model = env.NOTE_MODEL || "claude-opus-5";
    let feedback: string | undefined;
    let inputTokens = 0, outputTokens = 0;
    let firstAttemptProblems: string[] | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { draft, refusal, usage } = await draftNote(client, model, { ...input, feedback });
      inputTokens += usage.inputTokens; outputTokens += usage.outputTokens;
      if (!draft) return { status: "failed", reason: refusal ? `refused: ${refusal}` : "unparseable response" };
      const check = checkNote(draft, sourceText);
      if (check.ok) {
        const note: DafNote = { ...draft, model, promptVersion: hashPrompt(), generatedAt: new Date().toISOString(), sources, usage: { inputTokens, outputTokens, attempts: attempt, estUsd: estimateUsd(model, inputTokens, outputTokens) } };
        await putNote(env.DAF_KV, t, daf, note);
        return { status: "generated", note, attempts: attempt, firstAttemptProblems };
      }
      firstAttemptProblems ??= check.problems;
      console.log(`[note] ${t.slug}/${daf} attempt ${attempt} rejected: ${check.problems.join(" | ")}`);
      feedback = check.problems.join(" ");
      if (attempt === 2) return { status: "failed", reason: "note failed grounding twice", problems: check.problems, lastDraft: draft };
    }
    return { status: "failed", reason: "unreachable" };
  } finally {
    if (!opts.skipLock) await releaseLock(env.DAF_KV, t, daf);
  }
}
