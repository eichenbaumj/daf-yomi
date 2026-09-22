/**
 * Writes the day's note with Claude, checks it against the text it was given,
 * and stores it. One retry with feedback; then give up for the day (the page
 * says the note is pending rather than showing anything ungrounded).
 *
 * With `judge: "once"` a draft that passes the gate is read once more by the judge (src/note/judge.ts): if the page
 * answers the question, or the question is only mechanics, or the summary misstates the page, one more draft is
 * written with the judge's feedback and stored if it passes the gate. Bounded at three drafts and one judge call, so
 * the cron's near-day bakes stay a few cents and a few minutes.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Env } from "../types";
import type { Tractate } from "../daf/tractates";
import { positionFor } from "../daf/position";
import type { DafRef } from "../daf/schedule";
import { loadDafSections } from "../sefaria/client";
import { checkNote } from "./grounding";
import { judgeNote, type Judgment } from "./judge";
import { NoteSchema, SYSTEM_PROMPT, hashPrompt, userMessage, type NoteDraft, type PromptInput } from "./prompt";
import { acquireLock, getNote, putNote, releaseLock, type DafNote } from "./store";

export type GenerateOutcome =
  | { status: "exists"; note: DafNote }
  | { status: "generated"; note: DafNote; attempts: number; firstAttemptProblems?: string[]; judged?: Judgment }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; problems?: string[]; lastDraft?: NoteDraft; judged?: Judgment };

export interface DraftResult { draft: NoteDraft | null; refusal?: string; usage: { inputTokens: number; outputTokens: number } }
export interface JudgeResult { judgment: Judgment | null; refusal?: string; usage: { inputTokens: number; outputTokens: number } }
/** The paid and network-bound steps, replaceable in tests (the pattern of src/og/bake.ts `CardBakeDeps`). */
export interface GenerateDeps {
  draft?: (input: PromptInput) => Promise<DraftResult>;
  judge?: (input: PromptInput, note: NoteDraft, sourceText: string) => Promise<JudgeResult>;
  buildInput?: typeof buildPromptInput;
}
export interface GenerateOpts { force?: boolean; skipLock?: boolean; countAgainstCap?: boolean; judge?: "off" | "once" }

export function positionLine(ref: DafRef): string {
  const p = positionFor(ref);
  return [p.seder, p.tractate, p.chapterLabel, p.dafOfTractate].filter(Boolean).join(" · ");
}

/** Assemble the plain-English source for a daf. Exported for scripts. */
export async function buildPromptInput(ref: DafRef, kv?: KVNamespace): Promise<{ input: PromptInput; sources: string[]; sourceText: string }> {
  const loaded = await loadDafSections(ref.tractate, ref.daf, ref.cycle, kv);
  const sections: PromptInput["sections"] = loaded.map((x) => ({
    label: x.label,
    text: x.text.enPlain.filter(Boolean).join("\n\n") || "(no English text available for this section)",
  }));
  const sourceText = sections.map((s) => s.text).join("\n\n");
  return {
    input: { label: `${ref.tractate.name} ${ref.daf}`, positionLine: positionLine(ref), sections },
    sources: loaded.map((x) => x.text.urlRef),
    sourceText,
  };
}

/** List prices per million tokens, for the cost estimate stored with each note. */
const PRICE_USD_PER_M: Record<string, { input: number; output: number }> = { "claude-opus-5": { input: 5, output: 25 } };
export function estimateUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICE_USD_PER_M[model] ?? PRICE_USD_PER_M["claude-opus-5"]!;
  return Math.round(((inputTokens * p.input + outputTokens * p.output) / 1e6) * 10000) / 10000;
}

export async function draftNote(client: Anthropic, model: string, input: PromptInput): Promise<DraftResult> {
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
export async function ensureNote(env: Env, ref: DafRef, opts: GenerateOpts = {}, deps: GenerateDeps = {}): Promise<GenerateOutcome> {
  const { tractate: t, daf } = ref;
  if (!opts.force) {
    const existing = await getNote(env.DAF_KV, t, daf);
    if (existing) return { status: "exists", note: existing };
  }
  if (!env.ANTHROPIC_API_KEY && !deps.draft) return { status: "skipped", reason: "ANTHROPIC_API_KEY is not set" };
  // Hard daily cap on paid generations, whatever the trigger (cron, self-heal, admin without ?force).
  // The counter is one KV write per generation; the cap is far below anything a normal day needs.
  if (!opts.force || opts.countAgainstCap) {
    const dayKey = `gen:${new Date().toISOString().slice(0, 10)}`;
    const used = Number((await env.DAF_KV.get(dayKey)) ?? 0);
    const cap = Number(env.DAILY_GENERATION_CAP ?? 12);
    if (used >= cap) return { status: "skipped", reason: `daily generation cap of ${cap} reached (${used} today)` };
    await env.DAF_KV.put(dayKey, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  }
  if (!opts.skipLock && !(await acquireLock(env.DAF_KV, t, daf))) return { status: "skipped", reason: "another generation is in progress" };
  try {
    const { input, sources, sourceText } = await (deps.buildInput ?? buildPromptInput)(ref, env.DAF_KV);
    if (sourceText.replace(/\s+/g, " ").length < 200) return { status: "failed", reason: "source text too short to write from" };
    const model = env.NOTE_MODEL || "claude-opus-5";
    const judgeModel = env.NOTE_JUDGE_MODEL || model;
    const client = deps.draft && deps.judge ? null : new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
    const draft = deps.draft ?? ((i: PromptInput) => draftNote(client!, model, i));
    const judge = deps.judge ?? ((i: PromptInput, n: NoteDraft, src: string) => judgeNote(client!, judgeModel, i, n, src));
    const withJudge = opts.judge === "once";
    const maxDrafts = withJudge ? 3 : 2;
    let feedback: string | undefined;
    let inputTokens = 0, outputTokens = 0;
    let firstAttemptProblems: string[] | undefined;
    let judged: Judgment | undefined;
    let rewritten = false;
    for (let attempt = 1; attempt <= maxDrafts; attempt++) {
      const { draft: d, refusal, usage } = await draft({ ...input, feedback });
      inputTokens += usage.inputTokens; outputTokens += usage.outputTokens;
      if (!d) return { status: "failed", reason: refusal ? `refused: ${refusal}` : "unparseable response", judged };
      const check = checkNote(d, sourceText);
      if (!check.ok) {
        firstAttemptProblems ??= check.problems;
        console.log(`[note] ${t.slug}/${daf} attempt ${attempt} rejected: ${check.problems.join(" | ")}`);
        feedback = check.problems.join(" ");
        if (attempt === maxDrafts) return { status: "failed", reason: "note failed grounding twice", problems: check.problems, lastDraft: d, judged };
        continue;
      }
      if (withJudge && !judged) {
        const j = await judge(input, d, sourceText);
        inputTokens += j.usage.inputTokens; outputTokens += j.usage.outputTokens;
        if (j.judgment) {
          judged = j.judgment;
          if (judged.verdict === "rebake" && attempt < maxDrafts) {
            rewritten = true;
            feedback = judged.feedback;
            console.log(`[note] ${t.slug}/${daf} attempt ${attempt} sent back by the judge (${judged.reasons.join(", ")}): ${judged.feedback}`);
            continue;
          }
        } else {
          console.log(`[note] ${t.slug}/${daf} judge gave no verdict: ${j.refusal ?? "unknown"}`);
        }
      }
      const note: DafNote = {
        ...d, model, promptVersion: hashPrompt(), generatedAt: new Date().toISOString(), sources,
        usage: { inputTokens, outputTokens, attempts: attempt, estUsd: estimateUsd(model, inputTokens, outputTokens) },
        wordCount: sourceText.split(/\s+/).filter(Boolean).length,
        ...(judged ? { review: { at: new Date().toISOString(), judgeVersion: judged.judgeVersion, questionStatus: judged.questionStatus, reach: judged.reach, verdict: judged.verdict, rewritten, ...(judged.unverified ? { unverified: true } : {}) } } : {}),
      };
      await putNote(env.DAF_KV, t, daf, note);
      return { status: "generated", note, attempts: attempt, firstAttemptProblems, judged };
    }
    return { status: "failed", reason: "unreachable" };
  } finally {
    if (!opts.skipLock) await releaseLock(env.DAF_KV, t, daf);
  }
}
