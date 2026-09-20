/**
 * Code-enforced guardrails for the AI note. The prompt asks; this checks.
 */
import type { NoteDraft } from "./prompt";

export const BANNED_WORDS = ["leverage", "robust", "seamless", "holistic", "delve", "tapestry", "nuanced", "profound", "timeless", "resonate", "unpack", "journey", "testament", "underscore"];
const BANNED_PHRASES = ["a fortiori", "a priori", "prima facie", "ipso facto", "mutatis mutandis", "teaches us", "reminds us", "wants us", "we learn", "we see", "we are", "let us", "in this daf", "this page,", "this page "];

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
export const GLOSS_TERMS = ["issar", "zuz", "sela", "dinar", "perutah", "maneh", "kav", "seah", "kor", "tefach", "parasang", "teruma", "terumah", "maaser", "korban", "olah", "chatat", "asham", "minchah", "shelamim", "todah", "bikkurim", "orlah", "kilayim", "shemitta", "yovel", "eruv", "muktzeh", "melakhah", "karet", "ketubah", "chalitzah", "yibbum", "nazirite", "tosefta", "mitzva", "mitzvah", "mitzvot", "halakha", "halakhah", "halacha"];
/** Legal categories the translation renders in English words that still mean nothing to a newcomer. */
export const GLOSS_PHRASES = ["firstborn status", "priestly gifts", "levirate marriage", "sin offering", "guilt offering", "burnt offering", "peace offering", "meal offering", "first fruits", "second tithe", "first tithe", "poor man's tithe", "heave offering", "the Temple treasury", "consecrated property", "the red heifer", "the scapegoat", "a nazirite vow", "the Sabbatical Year", "the Jubilee", "an eruv", "the Paschal lamb", "the show bread", "the omer"];
export function unglossed(text: string): string[] {
  const out: string[] = [];
  const terms = [...GLOSS_TERMS, ...GLOSS_PHRASES];
  for (const term of terms) {
    const pattern = term.split(/[\s-]+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]+");
    const re = new RegExp(`\\b${pattern}s?\\b`, "i");
    const m = re.exec(text);
    if (!m) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const glossed =
      /^\s*[,(]/.test(after) ||                                   // "issar, a small coin" / "dinars, silver coins" / "(…)"
      /^\s*(of|worth|in|per|called|known as|that is|meaning)\s/i.test(after) || // "dinars of silver", "a sin offering called a chatat"
      /\((?:[^)]*)$/.test(before) ||                                // inside an open parenthesis
      /\b(called|known as|termed)\s+(a|an|the)?\s*$/i.test(before) ||
      /\b(silver|copper|gold|bronze|small|large|liquid|dry)\s+(coins?\s+(called|of)\s+)?$/i.test(before) || // "silver dinars", "small copper coin called an issar"
      /\b(a|an|the|one|two|three|four|five|six|ten|hundred|thousand)\s+(measures?|coins?|portions?|offerings?|gifts?)\s+(of|called)\s+(a|an|the)?\s*$/i.test(before); // "a measure of…", "two coins of…"
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
