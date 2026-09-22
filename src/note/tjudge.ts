/**
 * The Hebrew judge: a second reading of a translated note beside the English note it was made from. The regex gate
 * (checkTranslation) checks quotes, lengths and banned words; until this, nothing read the Hebrew. The judge answers
 * what the gate cannot: does the Hebrew say what the English says, is it the same question, and would an Israeli
 * learner write it that way, or is it English syntax in Hebrew words.
 *
 * As in src/note/judge.ts the verdict is derived here, in code, never taken from the model's own `modelVerdict`: every
 * span the judge points at is checked verbatim against the translation (and, for a fidelity problem, the English span
 * against the English note), and a span that is not there does not count. So a judge that misquotes the Hebrew never
 * re-translates anything.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import judgeGuideHe from "../../prompts/daf-judge-he.md";
import { fingerprint } from "./fingerprint";
import { normalize } from "./grounding";
import { normalizeHe } from "./hebrew";

/** Bumped by hand when the Hebrew judge's criteria change enough that old verdicts should not be trusted. */
export const TRANSLATE_JUDGE_PROMPT_VERSION = "2026-09-22.1";
export const TJUDGE_SYSTEM = judgeGuideHe.trim();
/**
 * Verified language problems at or above this number send a translation back on their own (a fidelity problem or a
 * different question always does). A first guess; Joe tunes it after the first audit.
 */
export const LANGUAGE_REBAKE_THRESHOLD = 2;

export const TranslationJudgeSchema = z.object({
  fidelity: z.array(z.object({
    hebrew: z.string().describe("A span copied exactly from the Hebrew translation."),
    english: z.string().describe("The span of the English note it should have matched, copied exactly."),
    problem: z.string().describe("One line: what was added, dropped, softened or sharpened."),
  })).describe("Every claim the Hebrew makes that the English does not make, or drops; empty when the translation is faithful."),
  sameQuestion: z.boolean().describe("True when the Hebrew question asks what the English question asks, whatever the wording."),
  language: z.array(z.object({
    hebrew: z.string().describe("A span copied exactly from the Hebrew translation that an Israeli learner would not write."),
    kind: z.enum(["calque", "agreement", "register", "vague", "archaic"]),
    better: z.string().describe("The plain Hebrew a learner would say instead."),
  })).describe("Each place a reader would stumble; not taste."),
  naturalness: z.number().int().min(1).max(5).describe("5 reads as if written in Hebrew; 4 has one stumble; 3 is understood but the English shows through; 2 makes a reader reread; 1 is not Hebrew."),
  modelVerdict: z.enum(["keep", "rebake"]),
  feedback: z.string().describe("When rebake: two or three plain sentences in English on what the rewrite must do, naming the spans. Otherwise empty."),
});
export type TranslationJudgeRaw = z.infer<typeof TranslationJudgeSchema>;
export type LanguageKind = TranslationJudgeRaw["language"][number]["kind"];
export type TranslationVerdict = "keep" | "rebake";
export type TranslationReason = "fidelity" | "question" | "language";
/** The two fields the judge reads; a DafNote, a TranslationDraft and a TranslatedNote all fit. */
export interface NotePair { summary: string; question: string }

export interface TranslationJudgment {
  judgeVersion: string;
  /** Fidelity problems whose Hebrew span is in the translation and whose English span is in the note. */
  fidelity: { hebrew: string; english: string; problem: string }[];
  /** Language problems whose span is in the translation. */
  language: { hebrew: string; kind: LanguageKind; better: string }[];
  sameQuestion: boolean;
  /** 1 to 5, the judge's own reading; recorded, never a reason by itself. */
  naturalness: number;
  verdict: TranslationVerdict;
  /** Why the verdict is rebake, in the audit's vocabulary. */
  reasons: TranslationReason[];
  /** The judge pointed at words that are not in the translation (or the English); that item was discounted. */
  unverified: boolean;
  modelVerdict: TranslationVerdict;
  /** What the rewrite is told. Empty on keep. */
  feedback: string;
}
export interface TranslationJudgeResult { judgment: TranslationJudgment | null; refusal?: string; usage: { inputTokens: number; outputTokens: number } }

export function hashTranslateJudgePrompt(): string {
  return fingerprint(TRANSLATE_JUDGE_PROMPT_VERSION, TJUDGE_SYSTEM);
}

/** The pair of notes and nothing else: no page text, so a call is about a thousand input tokens. */
export function translationJudgeUserMessage(label: string, english: NotePair, hebrew: NotePair): string {
  return [
    `The note for ${label}, in English, as it was checked against the page:`,
    `SUMMARY: ${english.summary}\n\nQUESTION: ${english.question}`,
    `THE HEBREW TRANSLATION`,
    `SUMMARY: ${hebrew.summary}\n\nQUESTION: ${hebrew.question}`,
    `Judge the translation as the guide says. Return only the structured fields.`,
  ].join("\n\n");
}

const inHebrew = (src: string, span: string) => { const s = normalizeHe(span); return s.length > 0 && src.includes(s); };
const inEnglish = (src: string, span: string) => { const s = normalize(span); return s.length > 0 && src.includes(s); };
const sentence = (s: string) => { const t = s.trim(); return /[.!?]$/.test(t) ? t : `${t}.`; };
const KIND_WORDS: Record<LanguageKind, string> = { calque: "reads as a calque", agreement: "does not agree", register: "is the wrong register", vague: "is vague", archaic: "is archaic" };

/** The verdict, derived from the fields, the translation and the English note. Pure. */
export function verifyTranslationJudgment(raw: TranslationJudgeRaw, translation: NotePair, english: NotePair): TranslationJudgment {
  const he = normalizeHe(`${translation.summary} ${translation.question}`);
  const en = normalize(`${english.summary} ${english.question}`);
  let unverified = false;
  const fidelity = raw.fidelity.filter((f) => {
    const ok = inHebrew(he, f.hebrew) && inEnglish(en, f.english);
    if (!ok) unverified = true;
    return ok;
  });
  const language = raw.language.filter((l) => {
    const ok = inHebrew(he, l.hebrew);
    if (!ok) unverified = true;
    return ok;
  });
  const reasons: TranslationReason[] = [];
  if (fidelity.length) reasons.push("fidelity");
  if (!raw.sameQuestion) reasons.push("question");
  if (language.length >= LANGUAGE_REBAKE_THRESHOLD) reasons.push("language");
  const verdict: TranslationVerdict = reasons.length ? "rebake" : "keep";
  const lines: string[] = [];
  for (const f of fidelity) {
    const p = f.problem.trim();
    lines.push(`The Hebrew says "${f.hebrew.trim()}" where the English says "${f.english.trim()}"${p ? `: ${sentence(p)}` : ". Say what the English says."}`);
  }
  if (reasons.includes("question")) lines.push("The Hebrew question is not the English question. Ask the same question, in plain Hebrew, and nothing else.");
  for (const l of language) lines.push(`"${l.hebrew.trim()}" ${KIND_WORDS[l.kind]}; say "${l.better.trim()}".`);
  if (verdict === "rebake" && raw.feedback.trim() && raw.modelVerdict === "rebake") lines.push(raw.feedback.trim());
  return {
    judgeVersion: hashTranslateJudgePrompt(),
    fidelity, language, sameQuestion: raw.sameQuestion, naturalness: raw.naturalness,
    verdict, reasons, unverified, modelVerdict: raw.modelVerdict,
    feedback: verdict === "rebake" ? lines.join(" ") : "",
  };
}

/** The request body for one judge call, shared by the live path and the Batch API scripts. */
export function translationJudgeRequest(model: string, label: string, english: NotePair, hebrew: NotePair) {
  return {
    model,
    max_tokens: 8000,
    system: TJUDGE_SYSTEM,
    messages: [{ role: "user" as const, content: translationJudgeUserMessage(label, english, hebrew) }],
    output_config: { format: zodOutputFormat(TranslationJudgeSchema) },
  };
}

/**
 * One judge call. The spans are verified against `hebrew` itself, so the caller passes the draft it wants read and
 * nothing else. A client-side schema failure (a naturalness of 6) throws like a network error; the caller decides
 * whether that stops anything (the Worker treats it as no verdict).
 */
export async function judgeTranslation(client: Anthropic, model: string, label: string, english: NotePair, hebrew: NotePair): Promise<TranslationJudgeResult> {
  // messages.create rather than messages.parse: a verdict cut off at max_tokens (Opus 5 thinks first, and the
  // thinking counts) or refused must come back as "no verdict" with its usage, not as a thrown parse error.
  const response = await client.messages.create(translationJudgeRequest(model, label, english, hebrew));
  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  if (response.stop_reason === "refusal") return { judgment: null, refusal: response.stop_details?.explanation ?? "model declined", usage };
  if (response.stop_reason === "max_tokens") return { judgment: null, refusal: "verdict cut off at max_tokens", usage };
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = TranslationJudgeSchema.safeParse((() => { try { return JSON.parse(text); } catch { return null; } })());
  if (!parsed.success) return { judgment: null, refusal: "no structured output", usage };
  return { judgment: verifyTranslationJudgment(parsed.data, hebrew, english), usage };
}
