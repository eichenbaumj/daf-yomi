/**
 * Translates an approved English note into another language, with the quotes
 * swapped for the original words of the daf, and checks the result against the
 * Hebrew/Aramaic text before storing it (src/note/tstore.ts). Same shape as
 * generate.ts: draft, check, one retry with feedback, then give up.
 *
 * With `judge: "once"` a draft that passes the gate is read once more by the Hebrew judge (src/note/tjudge.ts): if it
 * says something the English does not, asks a different question, or reads as English in Hebrew words, one more draft
 * is written with the judge's feedback and stored if it passes the gate. Bounded at three drafts and one judge call, and
 * a rewritten draft is never judged again, so the cron's translation pass stays a few cents.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import styleGuideHe from "../../prompts/daf-translate-he.md";
import type { Env } from "../types";
import type { DafRef } from "../daf/schedule";
import type { Lang } from "../i18n/strings";
import { loadDafSections } from "../sefaria/client";
import { plainText } from "../sefaria/sanitize";
import { takeGenerationSlot } from "./cap";
import { fingerprint } from "./fingerprint";
import { estimateUsd } from "./generate";
import type { GroundingResult } from "./grounding";
import { normalizeHe } from "./hebrew";
import { getNote, type DafNote } from "./store";
import { judgeTranslation, type NotePair, type TranslationJudgeResult, type TranslationJudgment } from "./tjudge";
import { getTranslation, putTranslation, type TranslatedNote } from "./tstore";

export { normalizeHe };

/** Bumped by hand when a translation style guide changes enough to re-translate the archive. */
export const TRANSLATE_PROMPT_VERSION = "2026-09-22.1";

export const TranslationSchema = z.object({
  summary: z.string().describe("The summary in the target language, same meaning, 45 to 70 words, never past 80."),
  question: z.string().describe("The same one question, ending in a question mark."),
  quotes: z.array(z.string()).max(2).describe("0-2 phrases of 12 words or fewer copied exactly from the original Hebrew/Aramaic text."),
});
export type TranslationDraft = z.infer<typeof TranslationSchema>;

export type TranslatableLang = Exclude<Lang, "en">;
const SYSTEM: Record<TranslatableLang, string> = { he: styleGuideHe.trim(), yi: "" };
export function systemPrompt(lang: TranslatableLang): string {
  const s = SYSTEM[lang];
  if (!s) throw new Error(`no translation style guide for ${lang}`);
  return s;
}
export function hashTranslatePrompt(lang: TranslatableLang): string {
  return fingerprint(TRANSLATE_PROMPT_VERSION, systemPrompt(lang));
}

export interface TranslateInput {
  lang: TranslatableLang;
  label: string; // "Bekhorot 2"
  note: { summary: string; question: string; quotes: string[] };
  /** Aligned segments per amud: the English (what the note was written from) beside the original. */
  sections: { label: string; pairs: { n: number; en: string; he: string }[] }[];
  feedback?: string;
}

export function translateUserMessage(input: TranslateInput): string {
  const body = input.sections.map((s) => `### ${s.label}\n\n${s.pairs.map((p) => `[${p.n}]\nEN: ${p.en}\nHE: ${p.he}`).join("\n\n")}`).join("\n\n");
  const parts = [
    `The note for ${input.label}, in English:`,
    `SUMMARY: ${input.note.summary}\nQUESTION: ${input.note.question}\nQUOTES: ${input.note.quotes.length ? input.note.quotes.map((q) => `"${q}"`).join(" | ") : "(none)"}`,
    `Below is the page the note was written from, segment by segment: the English translation (EN) beside the original Hebrew/Aramaic (HE). Quotes in your translation must be copied exactly from an HE line.`,
    body,
    `Translate the note into ${input.lang === "he" ? "Hebrew" : "Yiddish"} following the house style. Return only the structured fields.`,
  ];
  if (input.feedback) parts.push(`Your previous attempt was rejected: ${input.feedback} Fix that and try again.`);
  return parts.join("\n\n");
}

/** The aligned page plus the original text the quotes are checked against. Exported for scripts. */
export async function buildTranslateInput(ref: DafRef, lang: TranslatableLang, note: DafNote, kv?: KVNamespace): Promise<{ input: TranslateInput; heSource: string }> {
  const loaded = await loadDafSections(ref.tractate, ref.daf, ref.cycle, kv);
  const sections: TranslateInput["sections"] = loaded.map((x) => {
    const n = Math.max(x.text.en.length, x.text.he.length);
    const pairs: { n: number; en: string; he: string }[] = [];
    for (let i = 0; i < n; i++) pairs.push({ n: i + 1, en: x.text.enPlain[i] ?? "", he: plainText(x.text.he[i] ?? "") });
    return { label: x.label, pairs };
  });
  const heSource = sections.flatMap((s) => s.pairs.map((p) => p.he)).join("\n");
  return { input: { lang, label: `${ref.tractate.name} ${ref.daf}`, note: { summary: note.summary, question: note.question, quotes: note.quotes }, sections }, heSource };
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** No Rashi, Tosafot, Rambam, Steinsaltz or Sefaria inside the note: the Hebrew form of grounding.ts's LATER_AUTHORITIES. */
export const LATER_AUTHORITIES_HE = /רש[״"'’]י|תוספות|רמב[״"'’]ם|שטיינזלץ|ספריא|שולחן ערוך|משנה ברורה|בית יוסף|טור\b/;
/** "teaches us", "we learn", "reminds us", "let us": the sermon. */
export const SERMON_HE = /מלמד אותנו|מלמדת אותנו|אנו לומדים|אנחנו לומדים|מזכיר לנו|מזכירה לנו|עלינו ל|הבה נ/;
/** "On this daf", "this page": the throat-clearing opener. */
export const OPENERS_HE = /^(בדף (זה|הזה|היומי)|הדף (הזה|שלנו|של היום)|בסוגיה (זו|הזו))/;

/** Quoted spans of three or more words in the prose must be copies of the original. */
function quotedSpansHe(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/[“"„]([^”"]{4,200})[”"]/g)) {
    const span = m[1]!.trim();
    if (words(span) >= 3) out.push(span);
  }
  return out;
}

export function checkTranslation(draft: TranslationDraft, heSource: string, english: { summary: string; question: string }): GroundingResult {
  const problems: string[] = [];
  const src = normalizeHe(heSource);
  const prose = `${draft.summary} ${draft.question}`;
  const sw = words(draft.summary);
  if (sw > 80) problems.push(`summary is ${sw} words; keep it under 80.`);
  if (sw < 12) problems.push("summary is too short.");
  if (words(draft.question) > 35) problems.push("question is too long; one plain sentence.");
  if (!draft.question.trim().endsWith("?")) problems.push("question must end with a question mark.");
  // A question mark inside a quotation from the daf ("?!" is common in the Gemara's rhetoric) is the text's, not ours.
  const unquoted = prose.replace(/[“"„][^”"]{1,200}[”"]/g, "");
  if ((unquoted.match(/\?/g) ?? []).length !== 1) problems.push("ask exactly one question.");
  if (/[—]/.test(prose)) problems.push("no em dashes.");
  if (/[A-Za-z]/.test(prose)) problems.push("Hebrew letters only in the prose; no Latin letters.");
  if (!/\p{Script=Hebrew}/u.test(draft.summary)) problems.push("the summary is not in Hebrew.");
  if (LATER_AUTHORITIES_HE.test(prose)) problems.push("do not mention later authorities, Steinsaltz or Sefaria.");
  if (SERMON_HE.test(prose)) problems.push("no sermon: no 'teaches us', 'we learn', 'reminds us'.");
  if (OPENERS_HE.test(draft.summary.trim())) problems.push("do not open with 'on this daf' or 'this page'.");
  if (draft.quotes.length > 2) problems.push("at most two quotes.");
  for (const q of draft.quotes) {
    if (words(q) > 12) problems.push(`quote too long: "${q}"`);
    if (!src.includes(normalizeHe(q))) problems.push(`quote not found verbatim in the original text: "${q}"`);
  }
  for (const span of quotedSpansHe(prose)) {
    if (!src.includes(normalizeHe(span))) problems.push(`quoted phrase not found in the original text: "${span}"`);
  }
  // A translation that is far shorter than its source has dropped something.
  const enWords = words(english.summary);
  if (enWords >= 40 && sw < enWords * 0.4) problems.push(`summary is much shorter than the English (${sw} vs ${enWords} words); keep every claim.`);
  return { ok: problems.length === 0, problems };
}

export interface TranslateDraftResult { draft: TranslationDraft | null; refusal?: string; usage: { inputTokens: number; outputTokens: number } }

export const TRANSLATE_MAX_TOKENS = 8000;

export async function draftTranslation(client: Anthropic, model: string, input: TranslateInput): Promise<{ draft: TranslationDraft | null; refusal?: string; usage: { inputTokens: number; outputTokens: number } }> {
  // messages.create rather than messages.parse: a draft cut off at max_tokens (Opus 5 thinks first, and the thinking
  // counts; Arakhin 9 failed three times at 4,000) or refused comes back as a failed draft with its usage, never as a
  // thrown parse error.
  const response = await client.messages.create({
    model,
    max_tokens: TRANSLATE_MAX_TOKENS,
    system: systemPrompt(input.lang),
    messages: [{ role: "user", content: translateUserMessage(input) }],
    output_config: { format: zodOutputFormat(TranslationSchema) },
  });
  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  if (response.stop_reason === "refusal") return { draft: null, refusal: response.stop_details?.explanation ?? "model declined", usage };
  if (response.stop_reason === "max_tokens") return { draft: null, refusal: `output cut off at ${TRANSLATE_MAX_TOKENS} tokens`, usage };
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = TranslationSchema.safeParse((() => { try { return JSON.parse(text); } catch { return null; } })());
  if (!parsed.success) return { draft: null, refusal: "unparseable output", usage };
  return { draft: parsed.data, usage };
}

export type TranslateOutcome =
  | { status: "exists"; translation: TranslatedNote }
  | { status: "generated"; translation: TranslatedNote; attempts: number; firstAttemptProblems?: string[]; judged?: TranslationJudgment }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; problems?: string[]; lastDraft?: TranslationDraft; judged?: TranslationJudgment };

/** The paid and network-bound steps, replaceable in tests (the pattern of src/note/generate.ts `GenerateDeps`). */
export interface TranslateDeps {
  draft?: (input: TranslateInput) => Promise<TranslateDraftResult>;
  judge?: (label: string, english: NotePair, hebrew: NotePair) => Promise<TranslationJudgeResult>;
  buildInput?: typeof buildTranslateInput;
}
export interface TranslateOpts { force?: boolean; countAgainstCap?: boolean; judge?: "off" | "once" }

/** Is this translation the one the page should show under the current English note and style? */
export function translationCurrent(note: DafNote, tr: TranslatedNote | null, lang: TranslatableLang): boolean {
  return Boolean(tr && tr.of === note.generatedAt && tr.promptVersion === hashTranslatePrompt(lang));
}

/**
 * Translate (or fetch) the note for a daf in a language. Never called from a page visit: translations are made by
 * the cron for the near days and by scripts/translate.ts for everything else.
 */
export async function ensureTranslation(env: Env, ref: DafRef, lang: TranslatableLang, opts: TranslateOpts = {}, deps: TranslateDeps = {}): Promise<TranslateOutcome> {
  const { tractate: t, daf } = ref;
  const note = await getNote(env.DAF_KV, t, daf);
  if (!note) return { status: "skipped", reason: "no English note to translate" };
  if (!opts.force) {
    const existing = await getTranslation(env.DAF_KV, lang, t, daf);
    if (existing && translationCurrent(note, existing, lang)) return { status: "exists", translation: existing };
  }
  if (!env.ANTHROPIC_API_KEY && !deps.draft) return { status: "skipped", reason: "ANTHROPIC_API_KEY is not set" };
  // Hard daily cap on paid generations, whatever the trigger (cron, admin without ?force): src/note/cap.ts.
  if (!opts.force || opts.countAgainstCap) {
    const slot = await takeGenerationSlot(env);
    if (!slot.ok) return { status: "skipped", reason: slot.reason };
  }
  const { input, heSource } = await (deps.buildInput ?? buildTranslateInput)(ref, lang, note, env.DAF_KV);
  if (heSource.length < 100) return { status: "failed", reason: "original text too short to check quotes against" };
  const model = env.NOTE_MODEL || "claude-opus-5";
  const judgeModel = env.NOTE_JUDGE_MODEL || model;
  const client = deps.draft && deps.judge ? null : new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  const draft = deps.draft ?? ((i: TranslateInput) => draftTranslation(client!, model, i));
  const judge = deps.judge ?? ((label: string, en: NotePair, he: NotePair) => judgeTranslation(client!, judgeModel, label, en, he));
  const withJudge = opts.judge === "once";
  const maxDrafts = withJudge ? 3 : 2;
  let feedback: string | undefined;
  let inputTokens = 0, outputTokens = 0;
  let firstAttemptProblems: string[] | undefined;
  let judged: TranslationJudgment | undefined;
  let rewritten = false;
  for (let attempt = 1; attempt <= maxDrafts; attempt++) {
    const { draft: d, refusal, usage } = await draft({ ...input, feedback });
    inputTokens += usage.inputTokens; outputTokens += usage.outputTokens;
    if (!d) return { status: "failed", reason: refusal ? `refused: ${refusal}` : "unparseable response", judged };
    const check = checkTranslation(d, heSource, note);
    if (!check.ok) {
      firstAttemptProblems ??= check.problems;
      console.log(`[translate:${lang}] ${t.slug}/${daf} attempt ${attempt} rejected: ${check.problems.join(" | ")}`);
      feedback = check.problems.join(" ");
      if (attempt === maxDrafts) return { status: "failed", reason: `translation failed the checks ${attempt === 2 ? "twice" : `${attempt} times`}`, problems: check.problems, lastDraft: d, judged };
      continue;
    }
    if (withJudge && !judged) {
      // The judge is advisory: a refusal, an unparseable verdict or a network error never stops a draft that passed the gate.
      const j = await judge(input.label, note, d).catch((e: unknown): TranslationJudgeResult => ({ judgment: null, refusal: e instanceof Error ? e.message : String(e), usage: { inputTokens: 0, outputTokens: 0 } }));
      inputTokens += j.usage.inputTokens; outputTokens += j.usage.outputTokens;
      if (j.judgment) {
        judged = j.judgment;
        if (judged.verdict === "rebake" && attempt < maxDrafts) {
          rewritten = true;
          feedback = judged.feedback;
          console.log(`[translate:${lang}] ${t.slug}/${daf} attempt ${attempt} sent back by the judge (${judged.reasons.join(", ")}; naturalness ${judged.naturalness}): ${judged.feedback}`);
          continue;
        }
      } else {
        console.log(`[translate:${lang}] ${t.slug}/${daf} judge gave no verdict: ${j.refusal ?? "unknown"}`);
      }
    }
    const now = new Date().toISOString();
    const translation: TranslatedNote = {
      ...d, of: note.generatedAt, sourcePromptVersion: note.promptVersion, model, promptVersion: hashTranslatePrompt(lang),
      generatedAt: now,
      usage: { inputTokens, outputTokens, attempts: attempt, estUsd: estimateUsd(model, inputTokens, outputTokens) },
      ...(judged ? { review: { at: now, judgeVersion: judged.judgeVersion, naturalness: judged.naturalness, verdict: judged.verdict, reasons: judged.reasons, rewritten, ...(judged.unverified ? { unverified: true } : {}) } } : {}),
    };
    await putTranslation(env.DAF_KV, lang, t, daf, translation);
    return { status: "generated", translation, attempts: attempt, firstAttemptProblems, judged };
  }
  return { status: "failed", reason: "unreachable" };
}
