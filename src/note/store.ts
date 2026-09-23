import type { Tractate } from "../daf/tractates";
import { edgeDelete, edgeGet, edgePut } from "../edgecache";
import type { QuestionStatus, Reach, Verdict } from "./judge";

export interface DafNote {
  summary: string;
  question: string;
  quotes: string[];
  model: string;
  promptVersion: string;
  generatedAt: string;
  /** Sefaria URL refs the note was written from. */
  sources: string[];
  /** Token usage summed over attempts, and the estimated cost at the model's list price. */
  usage?: { inputTokens: number; outputTokens: number; attempts: number; estUsd: number };
  /** Words in the English source the note was written from; lets the email say "about N words" without fetching anything. */
  wordCount?: number;
  /**
   * The judge's reading (src/note/judge.ts) of the draft it saw, recorded only when the note is written anyway. When
   * `rewritten` is true the stored text is a later draft written with the judge's feedback, which was not judged again.
   */
  review?: { at: string; judgeVersion: string; questionStatus: QuestionStatus; reach: Reach; verdict: Verdict; rewritten: boolean; unverified?: boolean };
}

export const noteKey = (t: Tractate, daf: number) => `note:v1:${t.slug}:${daf}`;
const lockKey = (t: Tractate, daf: number) => `notelock:${t.slug}:${daf}`;

export async function getNote(kv: KVNamespace, t: Tractate, daf: number): Promise<DafNote | null> {
  return kv.get<DafNote>(noteKey(t, daf), "json");
}
export async function putNote(kv: KVNamespace, t: Tractate, daf: number, note: DafNote): Promise<void> {
  // generatedAt rides along as metadata so a list (the sitemap's lastmod) never has to read the notes themselves.
  await kv.put(noteKey(t, daf), JSON.stringify(note), { metadata: { generatedAt: note.generatedAt } });
}
/** Daf → generatedAt for every noted daf of the tractate; null where the note predates metadata (stamp it: POST /admin/notes/stamp). */
export async function notedDafimWithDates(kv: KVNamespace, t: Tractate): Promise<Map<number, string | null>> {
  const prefix = `note:v1:${t.slug}:`;
  const out = new Map<number, string | null>();
  let cursor: string | undefined;
  do {
    const page = await kv.list<{ generatedAt?: string }>({ prefix, cursor, limit: 1000 });
    for (const k of page.keys) out.set(Number(k.name.slice(prefix.length)), typeof k.metadata?.generatedAt === "string" ? k.metadata.generatedAt : null);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
/** Set of daf numbers in this tractate that already have a note. */
export async function notedDafim(kv: KVNamespace, t: Tractate): Promise<Set<number>> {
  const prefix = `note:v1:${t.slug}:`;
  const out = new Set<number>();
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    for (const k of page.keys) out.add(Number(k.name.slice(prefix.length)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
/** Best-effort lock so a burst of visitors does not trigger parallel generations. Lives on the edge cache (per data-centre, no write quota); a throttle, not a mutex. */
export async function acquireLock(_kv: KVNamespace, t: Tractate, daf: number, ttlSeconds = 300): Promise<boolean> {
  const k = lockKey(t, daf);
  if (await edgeGet<string>(k)) return false;
  await edgePut(k, new Date().toISOString(), ttlSeconds);
  return true;
}
export async function releaseLock(_kv: KVNamespace, t: Tractate, daf: number): Promise<void> {
  await edgeDelete(lockKey(t, daf));
}
