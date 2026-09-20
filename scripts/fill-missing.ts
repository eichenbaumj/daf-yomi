/**
 * Bake a note for every daf that has none, via POST /admin/bake (forced, so exempt from the daily cap).
 * The set of existing notes comes from a wrangler KV key listing you pass in, so this script needs no
 * KV binding of its own:
 *   npx wrangler kv key list --remote --namespace-id <id> > keys.json
 *   npm run fill:missing -- --site https://daf-yomi.dev --keys keys.json [--dry-run]
 */
import { readFileSync } from "node:fs";
import { TRACTATES } from "../src/daf/tractates";
import { dafForDate, dateForDaf, ymd } from "../src/daf/schedule";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const site = (opt("site") ?? "").replace(/\/$/, "");
const keysFile = opt("keys");
const dryRun = args.includes("--dry-run");
function tokenFromDevVars(): string | undefined {
  try { return /^ADMIN_TOKEN=(.+)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1]?.trim(); } catch { return undefined; }
}
const token = process.env.ADMIN_TOKEN ?? tokenFromDevVars();
if (!site || !keysFile || (!dryRun && !token)) { console.error("need --site, --keys <wrangler kv key list json>, and ADMIN_TOKEN (env or .dev.vars)"); process.exit(2); }

const have = new Set<string>();
for (const k of JSON.parse(readFileSync(keysFile, "utf8")) as { name: string }[]) {
  const m = /^note:v1:([a-z-]+):(\d+)$/.exec(k.name);
  if (m) have.add(`${m[1]}/${m[2]}`);
}
const today = new Date(); const cycle = dafForDate(new Date(today.getFullYear(), today.getMonth(), today.getDate())).cycle;
const missing: { slug: string; daf: number; date: Date }[] = [];
for (const t of TRACTATES) for (let d = t.firstDaf; d <= t.lastDaf; d++) if (!have.has(`${t.slug}/${d}`)) missing.push({ slug: t.slug, daf: d, date: dateForDaf(t, d, cycle) });
console.log(`${have.size} notes exist; ${missing.length} dapim missing${dryRun ? " (dry run)" : ""}`);
if (dryRun) { for (const m of missing) console.log(`  ${m.slug}/${m.daf}  (${ymd(m.date)})`); process.exit(0); }

let total = 0, ok = 0, failed = 0;
(async () => {
  for (const m of missing) {
    const url = `${site}/admin/bake?slug=${m.slug}&daf=${m.daf}&force=1`;
    let body: any = {};
    try {
      const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}` } });
      body = await res.json().catch(() => ({}));
      if (body.status === "generated" || body.status === "exists") ok++; else failed++;
    } catch (e) { failed++; body = { status: "error", reason: String(e) }; }
    const u = body.note?.usage; if (u) total += u.estUsd;
    console.log(`${m.slug}/${m.daf}: ${body.status ?? "?"} ${body.reason ?? ""}${u ? ` ≈ $${u.estUsd.toFixed(3)}` : ""}`);
    for (const p of body.problems ?? []) console.log(`    ↳ ${p}`);
  }
  console.log(`done: ${ok} ok, ${failed} failed, ≈ $${total.toFixed(2)} at list price`);
})();
