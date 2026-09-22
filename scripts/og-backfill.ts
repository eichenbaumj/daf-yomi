/**
 * Draw share cards on the deployed site through POST /admin/og/bake, a chunk at a time:
 *   npm run og:backfill -- --site https://daf-yomi.dev --window 3          # today ± 3 days
 *   npm run og:backfill -- --site https://daf-yomi.dev --dapim bekhorot/2,bekhorot/3
 *   npm run og:backfill -- --site https://daf-yomi.dev --all [--force]      # the whole cycle
 * Reads ADMIN_TOKEN from the environment or .dev.vars.
 *
 * The Worker skips current cards without launching a browser, so re-running is cheap. Browser Rendering's free
 * plan allows one new browser every 20 s (each chunk is one) and 10 minutes a day: the script waits 21 s between
 * chunks, retries once when the instance rate bites, and stops when the day's budget is gone, saying so.
 */
import { readFileSync } from "node:fs";
import { TRACTATES } from "../src/daf/tractates";
import { addDays, dafForDate, todayIn, type DafRef } from "../src/daf/schedule";
import { cycleStartDate } from "../src/daf/schedule";
import { CYCLE_LENGTH } from "../src/daf/tractates";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (k: string) => args.includes(`--${k}`);
const site = (opt("site") ?? "https://daf-yomi.dev").replace(/\/$/, "");
const chunkSize = Math.min(15, Math.max(1, Number(opt("chunk") ?? 15)));
const paceMs = Math.max(0, Number(opt("pace") ?? 21)) * 1000;

function tokenFromDevVars(): string | undefined {
  try { return /^ADMIN_TOKEN=(.+)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1]?.trim(); } catch { return undefined; }
}
const token = process.env.ADMIN_TOKEN ?? tokenFromDevVars();
if (!token) { console.error("need ADMIN_TOKEN (env or .dev.vars)"); process.exit(2); }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function targets(): string[] {
  const today = todayIn("UTC");
  const ids = new Map<string, true>();
  const add = (ref: DafRef) => ids.set(`${ref.tractate.slug}/${ref.daf}`, true);
  const window = Number(opt("window"));
  if (Number.isFinite(window)) for (let d = -window; d <= window; d++) add(dafForDate(addDays(today, d)));
  for (const x of (opt("dapim") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [slug, n] = x.split("/");
    if (!TRACTATES.some((t) => t.slug === slug) || !n) { console.error(`unknown daf ${x}`); process.exit(2); }
    ids.set(`${slug}/${Number(n)}`, true);
  }
  if (flag("all")) {
    const start = cycleStartDate(dafForDate(today).cycle);
    for (let i = 0; i < CYCLE_LENGTH; i++) add(dafForDate(addDays(start, i)));
  }
  return [...ids.keys()];
}

interface Outcome { daf: string; status: string; token?: string; bytes?: number; ms?: number; reason?: string; kind?: string }

async function bake(dapim: string[]): Promise<{ status: number; body: { ms?: number; kind?: string; outcomes?: Outcome[]; error?: string } }> {
  const res = await fetch(`${site}/admin/og/bake?dapim=${encodeURIComponent(dapim.join(","))}${flag("force") ? "&force=1" : ""}`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({})) as { ms?: number; kind?: string; outcomes?: Outcome[]; error?: string };
  return { status: res.status, body };
}

async function main() {
  const all = targets();
  if (all.length === 0) { console.error("no targets: use --window N, --dapim slug/daf, or --all"); process.exit(2); }
  console.log(`${all.length} dapim on ${site}, chunks of ${chunkSize}`);
  const tally: Record<string, number> = {};
  let launched = 0;
  for (let i = 0; i < all.length; i += chunkSize) {
    const chunk = all.slice(i, i + chunkSize);
    let r = await bake(chunk);
    if (r.status === 429 && r.body.kind === "rate") { console.log("  instance rate limit; waiting 21 s"); await sleep(21_000); r = await bake(chunk); }
    if (r.status === 401) { console.error("unauthorized: check ADMIN_TOKEN"); process.exit(1); }
    if (r.status === 503) { console.error(`site says: ${r.body.error}`); process.exit(1); }
    const outcomes = r.body.outcomes ?? [];
    for (const o of outcomes) {
      tally[o.status] = (tally[o.status] ?? 0) + 1;
      if (o.status === "rendered") console.log(`  ${o.daf}: drawn ${o.bytes} bytes in ${o.ms} ms`);
      else if (o.status === "failed") console.log(`  ${o.daf}: FAILED (${o.kind}) ${o.reason}`);
    }
    const drew = outcomes.some((o) => o.status === "rendered" || (o.status === "failed" && o.kind !== "other"));
    console.log(`[${i + chunk.length}/${all.length}] ${r.status} in ${r.body.ms ?? "?"} ms: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    if (r.status === 429 && r.body.kind === "budget") {
      console.log(`Browser time for today is used up (Cloudflare's free plan: 10 minutes a day). ${all.length - i - chunk.length} dapim not reached; run this again tomorrow, or leave the card cron's trickle to it.`);
      process.exit(3);
    }
    if (drew) { launched++; if (i + chunkSize < all.length) await sleep(paceMs); }
  }
  console.log(`done: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(", ")}; ${launched} browser launch(es)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
