import type { Env } from "../types";

/**
 * The hard daily cap on paid generations, whatever the trigger (cron, self-heal, admin without ?force), shared by
 * notes, translations and maps. One KV write per generation. The cap is far below anything a normal day needs: it
 * is the blast-radius limit put in after the 2026-09-20 crawl (HOSTING.md), and the Console spend limit is the
 * last line behind it.
 */
export async function takeGenerationSlot(env: Env): Promise<{ ok: true } | { ok: false; reason: string }> {
  const dayKey = `gen:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await env.DAF_KV.get(dayKey)) ?? 0);
  const cap = Number(env.DAILY_GENERATION_CAP ?? 12);
  if (used >= cap) return { ok: false, reason: `daily generation cap of ${cap} reached (${used} today)` };
  await env.DAF_KV.put(dayKey, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  return { ok: true };
}
