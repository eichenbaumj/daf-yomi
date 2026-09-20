/**
 * Small JSON cache on the Cloudflare edge (the Cache API). It has no write
 * quota, unlike Workers KV, which allows 1,000 writes a day on the free plan.
 * KV is reserved for the durable things: notes and resolved refs. Everything
 * that is merely a cache of Sefaria, or a short-lived lock, lives here.
 * The cache is per data-centre and may evict at will, so callers must treat a
 * miss as normal.
 */
const ORIGIN = "https://edge-cache.daf-yomi.invalid";

function store(): Cache | null {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}
function keyFor(name: string): Request {
  return new Request(`${ORIGIN}/${encodeURIComponent(name)}`, { method: "GET" });
}

export async function edgeGet<T>(name: string): Promise<T | null> {
  const c = store();
  if (!c) return null;
  const hit = await c.match(keyFor(name));
  if (!hit) return null;
  try { return (await hit.json()) as T; } catch { return null; }
}

export async function edgePut(name: string, value: unknown, ttlSeconds: number): Promise<void> {
  const c = store();
  if (!c) return;
  const res = new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json", "cache-control": `public, max-age=0, s-maxage=${ttlSeconds}` },
  });
  await c.put(keyFor(name), res);
}

export async function edgeDelete(name: string): Promise<void> {
  const c = store();
  if (!c) return;
  await c.delete(keyFor(name));
}
