/**
 * Lexical screens over a Hebrew note. They never fail a bake: triage only, the src/note/screen.ts pattern. They rank the
 * Hebrew audit (scripts/audit-he.ts) and the review rounds (scripts/try-translate.ts) so the judge's verdicts can be
 * read in a useful order, and they name the English-shaped Hebrew the judge exists to catch. The judge is blind to them.
 *
 * JavaScript's \b knows only ASCII word characters, so it never finds the edge of a Hebrew word; the screens use letter
 * lookarounds instead.
 */
import { normalizeHe } from "./hebrew";

export type ScreenFlagHe =
  | "calque"         // an English preposition or idiom in Hebrew words: "מן הכהן", "צעיר מכדי", "קריאות" for readings, "בתור", "מבחינת", a sentence closing on "לגמרי"
  | "long-sentence"  // a sentence of more than 28 words: the English sentence mirrored instead of re-said
  | "bare-verse"     // "פסוק" with no prefix letter: the verse without its article
  | "echo-question"; // the question opens with the summary's first four words

export interface ScreenedHe { flags: ScreenFlagHe[]; score: number }

const WEIGHTS: Record<ScreenFlagHe, number> = { calque: 3, "long-sentence": 2, "bare-verse": 1, "echo-question": 1 };
export const LONG_SENTENCE_WORDS = 28;

/** Prefix letters (ו, ה, ב, ל, כ, מ, ש, up to three) are allowed before "קריאות": "הקריאות" is the guide's own bad example. */
const CALQUE = /מן הכהן|צעיר מכדי|(?<![\p{L}])[והבלכמש]{0,3}קריאות(?![\p{L}])|(?<![\p{L}])ו?בתור(?![\p{L}])|מבחינת|לגמרי\s*(?:[.!?;]|$)/u;
const BARE_VERSE = /(?<![\p{L}])פסוק(?![\p{L}])/u;

const sentences = (s: string) => s.split(/[.!?;]+/).map((x) => x.trim()).filter(Boolean);
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
const firstWords = (s: string, n: number) => normalizeHe(s).split(" ").filter(Boolean).slice(0, n);

export function screenTranslation(note: { summary: string; question: string }): ScreenedHe {
  const flags: ScreenFlagHe[] = [];
  const prose = `${note.summary} ${note.question}`;
  if (CALQUE.test(prose)) flags.push("calque");
  if (sentences(prose).some((s) => wordCount(s) > LONG_SENTENCE_WORDS)) flags.push("long-sentence");
  if (BARE_VERSE.test(prose)) flags.push("bare-verse");
  const a = firstWords(note.summary, 4), b = firstWords(note.question, 4);
  if (a.length === 4 && a.join(" ") === b.join(" ")) flags.push("echo-question");
  const score = flags.reduce((n, f) => n + WEIGHTS[f], 0);
  return { flags, score };
}

/** Shorthand for reports: "calque+bare-verse (4)". */
export function screenLabelHe(s: ScreenedHe): string {
  return s.flags.length ? `${s.flags.join("+")} (${s.score})` : "clean";
}
