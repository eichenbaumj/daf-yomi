/** The small argument and admin-endpoint helpers every script re-implemented; shared here for the audit scripts. */
import { readFileSync } from "node:fs";

export const args = process.argv.slice(2);
export const opt = (k: string): string | undefined => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
export const flag = (k: string): boolean => args.includes(`--${k}`);
export const site = (opt("site") ?? "https://daf-yomi.dev").replace(/\/$/, "");

function tokenFromDevVars(): string | undefined {
  try { return /^ADMIN_TOKEN=(.+)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1]?.trim(); } catch { return undefined; }
}
/** The Anthropic key for batch work, from the environment or .dev.vars (it is a Worker secret, so it is not in wrangler.jsonc). */
if (!process.env.ANTHROPIC_API_KEY) {
  try { const k = /^ANTHROPIC_API_KEY=(.+)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1]?.trim(); if (k) process.env.ANTHROPIC_API_KEY = k; } catch { /* no .dev.vars */ }
}
export function adminToken(): string {
  const token = process.env.ADMIN_TOKEN ?? tokenFromDevVars();
  if (!token) { console.error("need ADMIN_TOKEN (env or .dev.vars)"); process.exit(2); }
  return token;
}

export async function adminJson(token: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${site}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` over `items` with at most `n` in flight. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!, i); }
  }));
  return out;
}
