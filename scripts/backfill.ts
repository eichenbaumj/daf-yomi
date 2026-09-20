/**
 * Bake notes on the deployed site for a date range via POST /admin/bake.
 *
 *   ADMIN_TOKEN=... npm run backfill -- --site https://daf-yomi.<acct>.workers.dev --from 2026-09-06 --to 2026-09-21 [--force]
 */
import { readFileSync } from "node:fs";
import { addDays, parseYmd, ymd } from "../src/daf/schedule";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const site = (opt("site") ?? "").replace(/\/$/, "");
function tokenFromDevVars(): string | undefined {
  try { return /^ADMIN_TOKEN=(.+)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1]?.trim(); } catch { return undefined; }
}
const token = process.env.ADMIN_TOKEN ?? tokenFromDevVars();
if (!site || !token) { console.error("need --site and ADMIN_TOKEN (env or .dev.vars)"); process.exit(2); }
const from = parseYmd(opt("from") ?? ""); const to = parseYmd(opt("to") ?? "");
if (!from || !to) { console.error("need --from and --to (YYYY-MM-DD)"); process.exit(2); }
const force = args.includes("--force");

let total = 0;
async function main() {
  for (let d = from!; d <= to!; d = addDays(d, 1)) {
    const url = `${site}/admin/bake?date=${ymd(d)}${force ? "&force=1" : ""}`;
    const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    const body: any = await res.json().catch(() => ({}));
    const u = body.note?.usage;
    if (u) total += u.estUsd;
    console.log(`${ymd(d)} ${body.daf ?? ""}: ${res.status} ${body.status ?? ""} ${body.reason ?? ""} ${body.attempts ? `(${body.attempts} attempt/s)` : ""}${u ? ` ${u.inputTokens} in / ${u.outputTokens} out ≈ $${u.estUsd.toFixed(3)}` : ""}`);
  }
}
main().then(() => console.log(`estimated total ≈ $${total.toFixed(2)} at list price`)).catch((e) => { console.error(e); process.exit(1); });
