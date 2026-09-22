/**
 * Lexical screens over a stored note. They never fail a bake: the house style is Joe's and stays as it is. They
 * rank the audit (scripts/audit-notes.ts) so the judge's verdicts can be read in a useful order, and they name the
 * shapes the judge exists to catch. The judge is blind to them.
 */
import { GLOSS_TERMS, normalize, unglossed } from "./grounding";

export type ScreenFlag =
  | "reason-seeking"     // asks for a purpose the Gemara usually supplies ("what did selling the ears change?")
  | "soft-rhetorical"    // "really", "actually", "at all?", "or not?": doubt dressed as a question (often just emphasis)
  | "interpretive"       // the summary characterises rather than reports ("seems to", "in effect")
  | "contradiction"      // "if X, why Y": the prompt's own approved shape, low weight
  | "mechanics"          // only quantities, measures or which-rule-applies, nothing underneath
  | "unglossed-question";// a glossary term in the question with no gloss anywhere

export interface Screened { flags: ScreenFlag[]; score: number }

const WEIGHTS: Record<ScreenFlag, number> = { "reason-seeking": 3, "soft-rhetorical": 2, interpretive: 2, mechanics: 3, "unglossed-question": 1, contradiction: 1 };

const REASON_SEEKING = /\b(what (?:did|does|would|has) [^?]{0,60}?\b(?:change|changed|accomplish|accomplished|add|added|achieve|achieved|matter|mattered|gain|gained)\b|why bother|what (?:was|is) the point|what difference|to what end|what (?:was|is) [^?]{0,30}\bfor)\b/i;
const SOFT_RHETORICAL = /\b(really|actually|simply|merely)\b|\bat all\s*\?|\bor not\s*\?/i;
const INTERPRETIVE = /\b(seems? to|appears? to|effectively|in effect|essentially|arguably|quietly|conveniently|tacitly|in other words|amounts to)\b/i;
const CONTRADICTION = /^if\b[^?]*\bwhy\b/i;
/** Words that mean the question has an idea in it; a mechanics question has none of these. */
const IDEA_WORDS = /\b(value[ds]?|valu(?:e|ing)|worth|promise[ds]?|intent(?:ion)?s?|intend(?:ed|s)?|trust(?:ed|s)?|own(?:ership|s|ed)?|belong(?:s|ed|ing)?|responsib\w+|fair(?:ness)?|just(?:ice)?|honest\w*|mean(?:s|ing)?|matter[s]?|count[s]? as|deserve[sd]?|obligat\w+|duty|duties|right[s]?|wrong|blame|guilt\w*|innocen\w+|forgive\w*|mercy|kind(?:ness)?|cruel\w*|dignity|shame\w*|memory|remember\w*|forget\w*|habit|character|choice|choose|free(?:dom)?|force[ds]?|need(?:s|ed)?|want(?:s|ed|ing)?|desire\w*|fear\w*|hope\w*|love\w*|hate\w*|know(?:s|ledge|ing)?|believ\w+|certain\w*|doubt\w*|reason\w*|purpose|why)\b/i;
const MECHANICS = new RegExp(`\\b(how (?:many|much|far|long|old)|which (?:side|half|part|one|of the two)|does [^?]{0,40}\\bcount as|is [^?]{0,40}\\b(?:a|an|the) (?:${GLOSS_TERMS.join("|")})s?\\b|(?:${GLOSS_TERMS.join("|")})s?\\b)`, "i");

export function screenNote(note: { summary: string; question: string }): Screened {
  const flags: ScreenFlag[] = [];
  const q = note.question.trim();
  if (REASON_SEEKING.test(q)) flags.push("reason-seeking");
  if (SOFT_RHETORICAL.test(q)) flags.push("soft-rhetorical");
  if (INTERPRETIVE.test(note.summary)) flags.push("interpretive");
  if (CONTRADICTION.test(q)) flags.push("contradiction");
  if (MECHANICS.test(q) && !IDEA_WORDS.test(q)) flags.push("mechanics");
  if (unglossed(q).length && unglossed(`${note.summary} ${q}`).length) flags.push("unglossed-question");
  const score = flags.reduce((n, f) => n + WEIGHTS[f], 0);
  return { flags, score };
}

/** Shorthand for reports: "reason-seeking+mechanics (6)". */
export function screenLabel(s: Screened): string {
  return s.flags.length ? `${s.flags.join("+")} (${s.score})` : "clean";
}

export { normalize };
