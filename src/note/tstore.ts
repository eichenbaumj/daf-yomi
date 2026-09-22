/**
 * Translated notes live in their own KV key, apart from the English note,
 * because a re-bake rewrites the note object wholesale (generate.ts) and would
 * drop anything stored inside it. A translation is bound to the English note it
 * was made from by `of` (that note's generatedAt): the page shows it only while
 * they match, so a re-baked English note retires its translations on its own.
 */
import type { Tractate } from "../daf/tractates";
import type { Lang } from "../i18n/strings";
import type { DafNote } from "./store";
import type { TranslationVerdict } from "./tjudge";

export interface TranslatedNote {
  summary: string;
  question: string;
  /** Phrases copied exactly from the Hebrew/Aramaic text of the daf (the original words, not a back-translation). */
  quotes: string[];
  /** generatedAt of the English note this was translated from. */
  of: string;
  sourcePromptVersion: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
  usage?: { inputTokens: number; outputTokens: number; attempts: number; estUsd: number };
  /**
   * The Hebrew judge's reading (src/note/tjudge.ts) of the draft it saw, recorded only when the translation is stored
   * anyway. When `rewritten` is true the stored text is a later draft written with the judge's feedback, which was not
   * judged again. `naturalness` is the judge's 1 to 5; `reasons` is empty on keep.
   */
  review?: { at: string; judgeVersion: string; naturalness: number; verdict: TranslationVerdict; reasons: string[]; rewritten: boolean; unverified?: boolean };
}

export const tnoteKey = (lang: Lang, t: Tractate, daf: number) => `tnote:v1:${lang}:${t.slug}:${daf}`;

export async function getTranslation(kv: KVNamespace, lang: Lang, t: Tractate, daf: number): Promise<TranslatedNote | null> {
  return kv.get<TranslatedNote>(tnoteKey(lang, t, daf), "json");
}
export async function putTranslation(kv: KVNamespace, lang: Lang, t: Tractate, daf: number, note: TranslatedNote): Promise<void> {
  await kv.put(tnoteKey(lang, t, daf), JSON.stringify(note));
}
/** The translation that belongs to this English note, or null when there is none or it is of an older bake. */
export function currentTranslation(note: DafNote | null, tr: TranslatedNote | null): TranslatedNote | null {
  return note && tr && tr.of === note.generatedAt ? tr : null;
}
