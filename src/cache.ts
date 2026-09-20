/** Edge cache for rendered HTML. Cloudflare does not cache Worker HTML on its own. */
export async function cachedResponse(cacheKey: string, ttlSeconds: number, build: () => Promise<Response>, bypass = false): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(cacheKey, { method: "GET" });
  if (!bypass) {
    const hit = await cache.match(key);
    if (hit) {
      const h = new Headers(hit.headers);
      h.set("x-daf-cache", "hit");
      return new Response(hit.body, { status: hit.status, headers: h });
    }
  }
  const fresh = await build();
  if (fresh.status === 200 && ttlSeconds > 0) {
    const h = new Headers(fresh.headers);
    h.set("Cache-Control", `public, max-age=0, s-maxage=${ttlSeconds}`);
    h.set("x-daf-cache", "miss");
    const out = new Response(fresh.body, { status: 200, headers: h });
    await cache.put(key, out.clone());
    return out;
  }
  return fresh;
}
