/**
 * The page text a note was written from (and, separately, the page as the map sees it), fetched once from Sefaria and
 * kept on disk (.cache/text/, .cache/map-text/). Scripts run without the Worker's edge cache, so without this every
 * audit pass would refetch ~5,400 pages. Requests are paced (Sefaria throttles bursts of ~75) and a 429 waits out
 * its Retry-After, the way scripts/verify-cycle.ts does.
 *
 * Two caches because the note's builder joins the non-empty segments into prose while the map's keeps every segment
 * numbered the way the page numbers it; one cannot be recovered from the other.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { DafRef } from "../../src/daf/schedule";
import { buildPromptInput } from "../../src/note/generate";
import { buildMapInput } from "../../src/map/generate";
import { SefariaError } from "../../src/sefaria/client";
import { keyOf } from "./targets";
import { sleep } from "./cli";

export type PageText = Awaited<ReturnType<typeof buildPromptInput>>;
export type MapPageText = Awaited<ReturnType<typeof buildMapInput>>;
const PACE_MS = Number(process.env.SEFARIA_PACE_MS ?? 1500);
let lastFetch = 0;

function cached<T>(dir: string, ref: DafRef): T | null {
  const path = `${dir}/${keyOf(ref).replace("/", "-")}.json`;
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

async function fetchCached<T>(dir: string, ref: DafRef, build: (ref: DafRef) => Promise<T>): Promise<T> {
  const hit = cached<T>(dir, ref);
  if (hit) return hit;
  mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastFetch + PACE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastFetch = Date.now();
    try {
      const text = await build(ref);
      writeFileSync(`${dir}/${keyOf(ref).replace("/", "-")}.json`, JSON.stringify(text));
      return text;
    } catch (e) {
      const status = e instanceof SefariaError ? e.status : undefined;
      if (status === 429 || (status !== undefined && status >= 500)) {
        const backoff = 30_000 * (attempt + 1);
        process.stderr.write(`Sefaria ${status} for ${keyOf(ref)}; waiting ${backoff / 1000}s\n`);
        await sleep(backoff);
        continue;
      }
      throw e;
    }
  }
  throw new Error(`gave up fetching ${keyOf(ref)}`);
}

export const cachedText = (ref: DafRef): PageText | null => cached<PageText>(".cache/text", ref);
export const pageText = (ref: DafRef): Promise<PageText> => fetchCached(".cache/text", ref, buildPromptInput);
export const cachedMapText = (ref: DafRef): MapPageText | null => cached<MapPageText>(".cache/map-text", ref);
export const pageMapText = (ref: DafRef): Promise<MapPageText> => fetchCached(".cache/map-text", ref, buildMapInput);
