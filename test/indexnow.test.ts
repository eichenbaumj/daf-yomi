import { describe, expect, it } from "vitest";
import { isIndexNowKeyPath, submitIndexNow, INDEXNOW_ENDPOINT } from "../src/indexnow";
import type { Env } from "../src/types";

const KEY = "0123456789abcdef0123456789abcdef";
const env = { INDEXNOW_KEY: KEY, CANONICAL_HOST: "daf-yomi.dev" } as unknown as Env;

describe("indexnow", () => {
  it("recognises only the configured key file", () => {
    expect(isIndexNowKeyPath(env, `/${KEY}.txt`)).toBe(true);
    expect(isIndexNowKeyPath(env, "/ffffffffffffffffffffffffffffffff.txt")).toBe(false);
    expect(isIndexNowKeyPath({} as Env, `/${KEY}.txt`)).toBe(false);
  });
  it("posts the host, key, key location and a de-duplicated url list", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("", { status: 202 }); }) as unknown as typeof fetch;
    const status = await submitIndexNow(env, ["https://daf-yomi.dev/", "https://daf-yomi.dev/bekhorot/4", "https://daf-yomi.dev/"], fetchFn);
    expect(status).toBe(202);
    expect(calls[0]!.url).toBe(INDEXNOW_ENDPOINT);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ host: "daf-yomi.dev", key: KEY, keyLocation: `https://daf-yomi.dev/${KEY}.txt`, urlList: ["https://daf-yomi.dev/", "https://daf-yomi.dev/bekhorot/4"] });
  });
  it("sends nothing without a key or without urls", async () => {
    let called = false;
    const fetchFn = (async () => { called = true; return new Response(""); }) as unknown as typeof fetch;
    expect(await submitIndexNow({ CANONICAL_HOST: "daf-yomi.dev" } as unknown as Env, ["https://daf-yomi.dev/"], fetchFn)).toBeNull();
    expect(await submitIndexNow(env, [], fetchFn)).toBeNull();
    expect(called).toBe(false);
  });
});
