/**
 * The judge: a second reading of a finished note against the page it came from. It answers what the grounding
 * gate cannot: is the question really open, does it reach an idea, does the summary say only what the page says.
 * The gate checks words; the judge reads.
 *
 * Its verdict is derived here, in code, from the structured fields, never taken from the model's own `modelVerdict`:
 * every page quotation the judge relies on is checked verbatim against the source, and an answer the judge cannot
 * point to on the page does not count. So a hallucinated "the page answers this" never re-bakes a note.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import judgeGuide from "../../prompts/daf-judge.md";
import { normalize } from "./grounding";
import type { PromptInput } from "./prompt";

/** Bumped by hand when the judge's criteria change enough that old verdicts should not be trusted. */
export const JUDGE_PROMPT_VERSION = "2026-09-22.1";
export const JUDGE_SYSTEM = judgeGuide.trim();

export const JudgeSchema = z.object({
  strongestAnswer: z.object({
    found: z.boolean().describe("True when the page itself states an answer to the question."),
    quote: z.string().describe("Up to 25 words copied exactly from the page that give the answer; empty when none."),
    where: z.string().describe("The section label the quote comes from, e.g. 'Bekhorot 3b'."),
    explanation: z.string().describe("One sentence."),
  }),
  questionStatus: z.enum(["open", "answered-on-page", "partly-answered"]),
  reach: z.enum(["idea", "case", "mechanics"]),
  reachNote: z.string().describe("One line: the idea the question reaches, or the idea under the case it missed."),
  summaryProblems: z.array(z.object({
    claim: z.string().describe("A statement in the summary the page does not support."),
    pageSays: z.string().describe("Up to 25 words copied exactly from the page that contradict it or show what the page says instead."),
  })),
  modelVerdict: z.enum(["keep", "rebake"]),
  feedback: z.string().describe("When rebake: two or three plain sentences on what the rewrite must do. Otherwise empty."),
});
export type JudgeRaw = z.infer<typeof JudgeSchema>;
export type QuestionStatus = JudgeRaw["questionStatus"];
export type Reach = JudgeRaw["reach"];
export type Verdict = "keep" | "rebake";

export interface Judgment {
  judgeVersion: string;
  questionStatus: QuestionStatus;
  reach: Reach;
  reachNote: string;
  /** The answer the judge found, only when its quote is on the page. */
  answer: { quote: string; where: string; explanation: string } | null;
  /** Summary problems whose page quotation verified. */
  summaryProblems: { claim: string; pageSays: string }[];
  verdict: Verdict;
  /** Why the verdict is rebake, in the audit's vocabulary. */
  reasons: ("answered-on-page" | "mechanics" | "summary-wrong")[];
  /** The judge pointed at page words that are not there; its answer was discounted. */
  unverified: boolean;
  modelVerdict: Verdict;
  /** What the rewrite is told. Empty on keep. */
  feedback: string;
}

export function hashJudgePrompt(): string {
  let h = 2166136261;
  for (let i = 0; i < JUDGE_SYSTEM.length; i++) { h ^= JUDGE_SYSTEM.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `${JUDGE_PROMPT_VERSION}-${h.toString(16)}`;
}

export function judgeUserMessage(input: PromptInput, note: { summary: string; question: string }): string {
  const body = input.sections.map((s) => `### ${s.label}\n\n${s.text}`).join("\n\n");
  return [
    `The page: ${input.label}. Position: ${input.positionLine}.`,
    `Below is the complete English text of the page, the only source the note was written from and the only evidence you may cite.`,
    body,
    `THE NOTE\n\nSUMMARY: ${note.summary}\n\nQUESTION: ${note.question}`,
    `Judge the note for ${input.label} as the guide says. Return only the structured fields.`,
  ].join("\n\n");
}

const onPage = (src: string, quote: string) => { const q = normalize(quote); return q.length > 0 && src.includes(q); };

/** The verdict, derived from the fields and the page. Pure. */
export function verifyJudgment(raw: JudgeRaw, sourceText: string): Judgment {
  const src = normalize(sourceText);
  let unverified = false;
  const answerVerified = raw.strongestAnswer.found && onPage(src, raw.strongestAnswer.quote);
  if (raw.strongestAnswer.found && !answerVerified) unverified = true;
  // An answer the judge cannot point to is not an answer the page gives.
  const questionStatus: QuestionStatus = raw.questionStatus === "answered-on-page" && !answerVerified ? "partly-answered" : raw.questionStatus;
  const summaryProblems = raw.summaryProblems.filter((p) => {
    const ok = onPage(src, p.pageSays);
    if (!ok) unverified = true;
    return ok;
  });
  const reasons: Judgment["reasons"] = [];
  if (questionStatus === "answered-on-page") reasons.push("answered-on-page");
  if (raw.reach === "mechanics") reasons.push("mechanics");
  if (summaryProblems.length) reasons.push("summary-wrong");
  const verdict: Verdict = reasons.length ? "rebake" : "keep";
  const lines: string[] = [];
  if (reasons.includes("answered-on-page")) lines.push(`The page answers your question in ${raw.strongestAnswer.where || "the text"}: "${raw.strongestAnswer.quote.trim()}". Do not ask it as if it were open: ask what remains difficult once that answer is on the table, or ask it as a reading question and say the page answers it.`);
  if (reasons.includes("mechanics")) lines.push(`The question is only mechanics (${raw.reachNote.trim() || "arithmetic or procedure"}). Ask at the level of the idea under the case, in plain words.`);
  for (const p of summaryProblems) lines.push(`The summary says "${p.claim.trim()}", but the page says "${p.pageSays.trim()}". Say what the page says.`);
  if (verdict === "rebake" && raw.feedback.trim() && raw.modelVerdict === "rebake") lines.push(raw.feedback.trim());
  return {
    judgeVersion: hashJudgePrompt(),
    questionStatus, reach: raw.reach, reachNote: raw.reachNote,
    answer: answerVerified ? { quote: raw.strongestAnswer.quote, where: raw.strongestAnswer.where, explanation: raw.strongestAnswer.explanation } : null,
    summaryProblems, verdict, reasons, unverified, modelVerdict: raw.modelVerdict,
    feedback: verdict === "rebake" ? lines.join(" ") : "",
  };
}

/** The request body for one judge call, shared by the live path and the Batch API scripts. */
export function judgeRequest(model: string, input: PromptInput, note: { summary: string; question: string }) {
  return {
    model,
    max_tokens: 4000,
    system: JUDGE_SYSTEM,
    messages: [{ role: "user" as const, content: judgeUserMessage(input, note) }],
    output_config: { format: zodOutputFormat(JudgeSchema) },
  };
}

export async function judgeNote(client: Anthropic, model: string, input: PromptInput, note: { summary: string; question: string }, sourceText: string): Promise<{ judgment: Judgment | null; refusal?: string; usage: { inputTokens: number; outputTokens: number } }> {
  const response = await client.messages.parse(judgeRequest(model, input, note));
  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  if (response.stop_reason === "refusal" || !response.parsed_output) return { judgment: null, refusal: response.stop_details?.explanation ?? "no structured output", usage };
  return { judgment: verifyJudgment(response.parsed_output, sourceText), usage };
}
