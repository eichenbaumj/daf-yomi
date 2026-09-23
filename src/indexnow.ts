/**
 * IndexNow: tell Bing (and through it DuckDuckGo and the engines that share the protocol) which URLs changed,
 * the moment the bake writes a note. Google does not take part; the sitemap's lastmod covers it. The key is
 * a 32-hex var (INDEXNOW_KEY) served back at /<key>.txt, which is how the protocol proves the host is ours.
 */
import type { Env } from "./types";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

export function isIndexNowKeyPath(env: Env, path: string): boolean {
  return Boolean(env.INDEXNOW_KEY) && path === `/${env.INDEXNOW_KEY}.txt`;
}

/** Returns the endpoint's status, or null when the key is unset or the list is empty (nothing sent). */
export async function submitIndexNow(env: Env, urls: string[], fetchFn: typeof fetch = fetch): Promise<number | null> {
  if (!env.INDEXNOW_KEY || !env.CANONICAL_HOST || urls.length === 0) return null;
  const host = env.CANONICAL_HOST;
  const body = { host, key: env.INDEXNOW_KEY, keyLocation: `https://${host}/${env.INDEXNOW_KEY}.txt`, urlList: [...new Set(urls)].slice(0, 10000) };
  try {
    const res = await fetchFn(INDEXNOW_ENDPOINT, { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
    console.log(`[indexnow] ${res.status} for ${body.urlList.length} url(s)`);
    return res.status;
  } catch (e) {
    console.error("[indexnow]", e);
    return null;
  }
}
