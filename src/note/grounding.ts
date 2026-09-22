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
    const re = new RegExp(`\\b${pattern}s?(?:'s)?\\b`, "gi");
    let seen = false;
    let glossed = false;
    for (const m of text.matchAll(re)) {
      seen = true;
      const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 80);
      const before = text.slice(Math.max(0, m.index! - 60), m.index!);
      // Any one occurrence carrying a gloss is enough ("three seah each, a seah being a dry measure…").
      if (
        /^\s*[,(]/.test(after) ||                                                                       // "dinars, silver coins" / "issar (a small coin)"
        /^[^.;?!]{0,32}?[,(]\s*(a|an|the|which|that|meaning|i\.e\.|or|about|roughly)\b/i.test(after) || // "…dinar's worth as he works, a coin…"
        /^\s*(of|worth|in|per|called|known as|that is|meaning|being)\s/i.test(after) ||            // "dinars of silver", "a parasang being…"
        /\((?:[^)]*)$/.test(before) ||                                                              // inside an open parenthesis
        /\b(called|known as|termed)\s+(a|an|the)?\s*$/i.test(before) ||
        /\b(silver|copper|gold|bronze|small|large|liquid|dry)\s+(coins?\s+(called|of)\s+)?$/i.test(before) ||
        /\b(a|an|the|one|two|three|four|five|six|ten|hundred|thousand)\s+(measures?|coins?|portions?|offerings?|gifts?)\s+(of|called)\s+(a|an|the)?\s*$/i.test(before)
      ) { glossed = true; break; }
    }
    if (seen && !glossed) out.push(text.match(re)![0]!);
  }
  return out;
}

/** "exempt", "liable", "obligated" etc. with no object: the reader is left asking "from what?" */
export function danglingLegalVerbs(text: string): string[] {
  const out: string[] = [];
  const rules: [RegExp, string][] = [
    [/\bexempt(?:ed|s)?\b(?!\s+(?:from|it|them|him|her|the\b[^.]{0,40}\bfrom))/gi, "exempt from what?"],
    [/\bliable\b(?!\s+(?:to|for))/gi, "liable to or for what?"],
    [/\bobligated\b(?!\s+(?:to|in))/gi, "obligated to do what?"],
  ];
  for (const [re, ask] of rules) for (const m of text.matchAll(re)) out.push(`${m[0]}: ${ask}`);
  return out;
}

/** Capitalised words a reader knows without introduction; anything else capitalised in the question must already be in the summary. */
const HOUSEHOLD_NAMES = new Set(["gemara", "talmud", "torah", "mishna", "mishnah", "bible", "rabbi", "rav", "rabban", "sages", "god", "heaven", "temple", "sanctuary", "shabbat", "sabbath", "israel", "jerusalem", "egypt", "jew", "jews", "jewish", "levite", "levites", "priest", "priests", "moses", "aaron", "david", "abraham", "isaac", "jacob", "exodus", "genesis", "leviticus", "numbers", "deuteronomy", "if", "when", "why", "what", "who", "how", "does", "is", "can", "should", "the", "a", "an", "in", "on", "once", "since", "after", "before", "given", "suppose", "i"]);

/**
 * Names the question introduces that the summary never mentioned. The reader has only the three sentences above
 * to go on, so a stranger arriving in the question ("what was Kontrokos standing on?") makes it unreadable.
 */
export function strangersInQuestion(question: string, summary: string): string[] {
  const seen = normalize(summary).toLowerCase();
  const out: string[] = [];
  for (const m of question.matchAll(/\b([A-Z][\p{L}'’]+)\b/gu)) {
    const w = m[1]!;
    const key = normalize(w).toLowerCase();
    if (HOUSEHOLD_NAMES.has(key) || key.length < 3) continue;
    if (!seen.includes(key) && !out.includes(w)) out.push(w);
  }
  return out;
}

/** Diacritics folded as well as normalize(): "Yoḥanan" and "Yohanan" are the same sage. */
export function fold(s: string): string {
  return normalize(s.normalize("NFD").replace(/\p{Mn}/gu, ""));
}

/**
 * Sages the note names that the page never does. The prompt says "name a sage only if that name appears in
 * today's text"; this makes it so. Only the name is compared, never the title, and spelling variants the
 * translations use are folded ("Rav Zeira" for the page's "Rabbi Zeira", "Yochanan" for "Yoḥanan", Guggenheimer's
 * "Joḥanan"), so the rule catches a sage who is absent, not one who is spelled differently.
 */
const TITLED_SAGE = /\b(?:Rabbi|Rav|Rabban|Rabbeinu|Mar)\s+([A-Z][\p{L}]+)/gu;
const UNTITLED_SAGES: [name: string, key: string][] = [["Abaye", "abaye"], ["Rava", "rava"], ["Rabba", "rabba"], ["Shmuel", "shmuel"], ["Hillel", "hillel"], ["Shammai", "shammai"], ["Ulla", "ulla"], ["Reish Lakish", "lakish"]];
const sageKey = (name: string) => fold(name).replace(/^j/, "y").replace(/ch/g, "h").replace(/tz/g, "z").replace(/kk/g, "k").replace(/bb/g, "b");
export function sagesNotOnPage(text: string, sourcePlainText: string): string[] {
  const src = sageKey(sourcePlainText);
  const out: string[] = [];
  const miss = (shown: string, key: string) => { if (!src.includes(key) && !out.includes(shown)) out.push(shown); };
  for (const m of text.matchAll(TITLED_SAGE)) miss(m[0], sageKey(m[1]!));
  for (const [name, key] of UNTITLED_SAGES) if (new RegExp(`\\b${name}\\b`).test(text)) miss(name, sageKey(key));
  return out;
}

/**
 * Glossary terms the question uses that the summary never introduced. The question cannot carry a gloss (one
 * sentence, no setup), so the summary must have said the word first; "dinars" in the question is fine after
 * "a dinar, a silver coin" in the summary.
 */
export function unintroducedTerms(question: string, summary: string): string[] {
  const sum = normalize(summary);
  const out: string[] = [];
  for (const term of [...GLOSS_TERMS, ...GLOSS_PHRASES]) {
    const pattern = term.split(/[\s-]+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]+");
    if (!new RegExp(`\\b${pattern}s?(?:'s)?\\b`, "i").test(question)) continue;
    // "mitzvot" in the question after "mitzva" in the summary: compare on a stem when the word is long enough.
    const norm = normalize(term);
    const stem = norm.length >= 6 ? norm.replace(/(ot|ah|a|s)$/, "") : norm;
    if (!sum.includes(stem) && !out.includes(term)) out.push(term);
  }
  return out;
}

/** "Isn't it odd that…?" is an assertion wearing a question mark; the prompt says "not rhetorical". */
const RHETORICAL_OPENER = /^(isn't|aren't|doesn't|don't|wasn't|weren't|didn't|shouldn't|couldn't|wouldn't|hasn't|haven't|surely|is it not|does it not)\b/i;

export interface GroundingResult { ok: boolean; problems: string[] }

export function checkNote(note: NoteDraft, sourcePlainText: string): GroundingResult {
  const problems: string[] = [];
  const src = normalize(sourcePlainText);
  const prose = `${note.summary} ${note.question}`;

  if (wordCount(note.summary) > 92) problems.push(`summary is ${wordCount(note.summary)} words; keep it to about 80, never past 90.`);
  for (const slip of articleSlips(prose)) problems.push(`article does not agree with the next word: "${slip}".`);
  for (const term of unglossed(note.summary)) problems.push(`gloss "${term}" in a few words the first time it appears; the reader has never opened a Talmud.`);
  for (const d of danglingLegalVerbs(prose)) problems.push(`legal verb left hanging, "${d}" Name the object.`);
  if (wordCount(note.summary) < 15) problems.push("summary is too short to say anything.");
  if (!/\?\s*$/.test(note.question.trim())) problems.push("question must end with a question mark.");
  if ((note.question.match(/\?/g) ?? []).length > 1) problems.push("ask exactly one question.");
  for (const n of strangersInQuestion(note.question, note.summary)) problems.push(`the question brings in "${n}", which the summary never mentions; the question must stand on the summary alone, so introduce it there or leave it out.`);
  if (/\b(standing on|hold water|on the spot|square with|at stake|beg the question|in play)\b/i.test(note.question)) problems.push("no idioms in the question; say it plainly (rely on, prove, permit).");
  if (RHETORICAL_OPENER.test(note.question.trim())) problems.push("the question is rhetorical; ask something the page leaves open, in a form that could be answered either way.");
  for (const term of unintroducedTerms(note.question, note.summary)) problems.push(`the question uses "${term}", which the summary never introduced; gloss it in the summary first or leave it out of the question.`);
  for (const name of sagesNotOnPage(prose, sourcePlainText)) problems.push(`"${name}" is not named on this page; name a sage only for a view the text attributes to them, in the page's own spelling.`);
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
