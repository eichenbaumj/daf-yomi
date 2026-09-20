/**
 * Code-enforced guardrails for the AI note. The prompt asks; this checks.
 */
import type { NoteDraft } from "./prompt";

export const BANNED_WORDS = ["leverage", "robust", "seamless", "holistic", "delve", "tapestry", "nuanced", "profound", "timeless", "resonate", "unpack", "journey", "testament", "underscore"];
const BANNED_PHRASES = ["teaches us", "reminds us", "wants us", "we learn", "we see", "we are", "let us", "in this daf", "this page,", "this page "];

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\p{L}\p{N}'" -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Quoted spans of three or more words inside prose must also come from the source. */
function quotedSpans(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/[“"]([^”"]{6,200})[”"]/g)) {
    const span = m[1]!.trim();
    if (wordCount(span) >= 3) out.push(span);
  }
  return out;
}

/** "a uprooted", "an carob": the one grammar slip the model makes often enough to check for. */
const A_BEFORE_VOWEL_OK = /^(one|uni|use|usu|eu|ur[aeiou]|ubi|uti|unani|u\b)/i; // "a one-time", "a university", "a useful", "a European", "a urine"
export function articleSlips(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(a|an) ([A-Za-z][a-z]+)/g)) {
    const article = m[1]!.toLowerCase();
    const word = m[2]!;
    const vowelStart = /^[aeiou]/i.test(word);
    if (article === "a" && vowelStart && !A_BEFORE_VOWEL_OK.test(word)) out.push(`${m[1]} ${word}`);
    if (article === "an" && !vowelStart && !/^h/i.test(word)) out.push(`${m[1]} ${word}`);
  }
  return out;
}

/**
 * Terms the translation leaves untranslated that a newcomer will not know. If one appears, the
 * sentence must gloss it: a parenthesis, or ", a …"/", the …"/" or …" within a few words after it.
 * The page's own vocabulary (mishna, Gemara, baraita, tanna, amora) is glossed once in the page legend
 * instead, so it is deliberately not listed here.
 */
export const GLOSS_TERMS = ["issar", "zuz", "sela", "dinar", "perutah", "maneh", "kav", "seah", "log", "kor", "tefach", "mil", "parasang", "teruma", "terumah", "maaser", "tithe", "korban", "olah", "chatat", "asham", "minchah", "shelamim", "todah", "bikkurim", "challah", "orlah", "kilayim", "shemitta", "yovel", "eruv", "muktzeh", "melakhah", "karet", "lashes", "get", "ketubah", "chalitzah", "yibbum", "sotah", "nazirite", "tosefta"];
export function unglossed(text: string): string[] {
  const out: string[] = [];
  for (const term of GLOSS_TERMS) {
    const re = new RegExp(`\\b${term}s?\\b`, "i");
    const m = re.exec(text);
    if (!m) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const glossed = /^\s*[,(]\s*(a|an|the|which|that|meaning|i\.e\.|or)\b/i.test(after) || /^\s*\(/.test(after) || /\((?:[^)]*)$/.test(before) || /\b(called|known as|termed)\s+(a|an|the)?\s*$/i.test(before);
    if (!glossed) out.push(m[0]);
  }
  return out;
}

export interface GroundingResult { ok: boolean; problems: string[] }

export function checkNote(note: NoteDraft, sourcePlainText: string): GroundingResult {
  const problems: string[] = [];
  const src = normalize(sourcePlainText);
  const prose = `${note.summary} ${note.question}`;

  if (wordCount(note.summary) > 92) problems.push(`summary is ${wordCount(note.summary)} words; keep it to about 80, never past 90.`);
  for (const slip of articleSlips(prose)) problems.push(`article does not agree with the next word: "${slip}".`);
  for (const term of unglossed(note.summary)) problems.push(`gloss "${term}" in a few words the first time it appears; the reader has never opened a Talmud.`);
  if (wordCount(note.summary) < 15) problems.push("summary is too short to say anything.");
  if (!/\?\s*$/.test(note.question.trim())) problems.push("question must end with a question mark.");
  if ((note.question.match(/\?/g) ?? []).length > 1) problems.push("ask exactly one question.");
  if (/[—]/.test(prose)) problems.push("no em dashes.");
  const lower = prose.toLowerCase();
  for (const w of BANNED_WORDS) if (new RegExp(`\\b${w}\\w*`, "i").test(prose)) problems.push(`banned word: ${w}.`);
  for (const p of BANNED_PHRASES) if (lower.includes(p)) problems.push(`banned phrase: "${p.trim()}".`);
  if (/^(in this daf|this page|today's page|on this daf)/i.test(note.summary.trim())) problems.push("do not open with 'In this daf' or 'This page'.");
  if (/^(\S+\s+){1,6}\S*:/.test(note.summary.trim())) problems.push("no teaser-and-colon opener ('X opens with donkeys:'); make the first sentence stand on its own.");
  if (/\b(rashi|tosafot|tosfot|maimonides|rambam|steinsaltz|sefaria|shulchan arukh|shulchan aruch)\b/i.test(prose)) problems.push("do not cite later authorities, Steinsaltz, or Sefaria.");
  if (note.quotes.length > 2) problems.push("at most two quotes.");
  for (const q of note.quotes) {
    if (wordCount(q) > 12) problems.push(`quote longer than 12 words: "${q}".`);
    if (!src.includes(normalize(q))) problems.push(`quote not found verbatim in the text: "${q}".`);
  }
  for (const span of quotedSpans(prose)) {
    if (!src.includes(normalize(span))) problems.push(`quoted phrase not found in the text: "${span}".`);
  }
  return { ok: problems.length === 0, problems };
}
