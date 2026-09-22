/**
 * Share cards live in KV next to the notes: `og:v1:<slug>:<daf>` holds the PNG, and the key's metadata says
 * which note it was drawn from (`of` = the note's generatedAt), which design (`cv`), which cycle's date it
 * shows, and the URL token. The page reads the metadata only; the image route reads the bytes.
 */
import type { Tractate } from "../daf/tractates";
import type { DafNote } from "../note/store";
import { CARD_VERSION } from "./card";

export interface CardMeta {
  /** generatedAt of the note whose question this card shows. */
  of: string;
  cv: number;
  cycle: number;
  token: string;
  bytes: number;
  renderedAt: string;
}

export const ogKey = (t: Tractate, daf: number) => `og:v1:${t.slug}:${daf}`;
export const OG_CURSOR_KEY = "ogcursor:v1";

export const cardPath = (t: Tractate, daf: number, token: string) => `/og/${t.slug}/${daf}/${token}.png`;

export async function putCard(kv: KVNamespace, t: Tractate, daf: number, png: Uint8Array, meta: CardMeta): Promise<void> {
  await kv.put(ogKey(t, daf), png, { metadata: meta });
}

/** Metadata only: the value stream is cancelled unread. */
export async function getCardMeta(kv: KVNamespace, t: Tractate, daf: number): Promise<CardMeta | null> {
  const r = await kv.getWithMetadata<CardMeta>(ogKey(t, daf), "stream");
  try { await r.value?.cancel(); } catch { /* nothing to release */ }
  return r.value ? r.metadata : null;
}

export async function getCard(kv: KVNamespace, t: Tractate, daf: number): Promise<{ png: ArrayBuffer; meta: CardMeta } | null> {
  const r = await kv.getWithMetadata<CardMeta>(ogKey(t, daf), "arrayBuffer");
  return r.value && r.metadata ? { png: r.value, meta: r.metadata } : null;
}

/** The page may point at the card: it shows the question the page shows. Design age does not matter here. */
export function cardCurrent(note: DafNote | null, meta: CardMeta | null): meta is CardMeta {
  return Boolean(note && meta && meta.of === note.generatedAt);
}

/** The bake should (re)draw it: no card, a different question, an older design, or another cycle's date. */
export function cardNeedsRender(note: DafNote, meta: CardMeta | null, cycle: number): boolean {
  return !meta || meta.of !== note.generatedAt || meta.cv !== CARD_VERSION || meta.cycle !== cycle;
}
