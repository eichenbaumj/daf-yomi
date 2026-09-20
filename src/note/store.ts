import type { Tractate } from "../daf/tractates";

export interface DafNote {
  summary: string;
  question: string;
  quotes: string[];
  model: string;
  promptVersion: string;
  generatedAt: string;
  /** Sefaria URL refs the note was written from. */
  sources: string[];
}

export const noteKey = (t: Tractate, daf: number) => `note:v1:${t.slug}:${daf}`;
const lockKey = (t: Tractate, daf: number) => `notelock:${t.slug}:${daf}`;

export async function getNote(kv: KVNamespace, t: Tractate, daf: number): Promise<DafNote | null> {
  return kv.get<DafNote>(noteKey(t, daf), "json");
}
export async function putNote(kv: KVNamespace, t: Tractate, daf: number, note: DafNote): Promise<void> {
  await kv.put(noteKey(t, daf), JSON.stringify(note));
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
/** Best-effort lock so a burst of visitors does not trigger parallel generations. KV is eventually consistent; this is a throttle, not a mutex. */
export async function acquireLock(kv: KVNamespace, t: Tractate, daf: number, ttlSeconds = 300): Promise<boolean> {
  const k = lockKey(t, daf);
  if (await kv.get(k)) return false;
  await kv.put(k, new Date().toISOString(), { expirationTtl: ttlSeconds });
  return true;
}
export async function releaseLock(kv: KVNamespace, t: Tractate, daf: number): Promise<void> {
  await kv.delete(lockKey(t, daf));
}
