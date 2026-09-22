/**
 * The page text a note was written from, fetched once from Sefaria and kept on disk (.cache/text/). Scripts run
 * without the Worker's edge cache, so without this every audit pass would refetch ~5,400 pages. Requests are paced
 * (Sefaria throttles bursts of ~75) and a 429 waits out its Retry-After, the way scripts/verify-cycle.ts does.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { DafRef } from "../../src/daf/schedule";
import { buildPromptInput } from "../../src/note/generate";
import { SefariaError } from "../../src/sefaria/client";
import { keyOf } from "./targets";
import { sleep } from "./cli";

export type PageText = Awaited<ReturnType<typeof buildPromptInput>>;
const DIR = ".cache/text";
const PACE_MS = Number(process.env.SEFARIA_PACE_MS ?? 1500);
let lastFetch = 0;

export function cachedText(ref: DafRef): PageText | null {
  const path = `${DIR}/${keyOf(ref).replace("/", "-")}.json`;
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as PageText) : null;
}

export async function pageText(ref: DafRef): Promise<PageText> {
  const hit = cachedText(ref);
  if (hit) return hit;
  mkdirSync(DIR, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastFetch + PACE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastFetch = Date.now();
    try {
      const text = await buildPromptInput(ref);
      writeFileSync(`${DIR}/${keyOf(ref).replace("/", "-")}.json`, JSON.stringify(text));
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
