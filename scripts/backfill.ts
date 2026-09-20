/**
 * Bake notes on the deployed site for a date range via POST /admin/bake.
 *
 *   ADMIN_TOKEN=... npm run backfill -- --site https://daf-yomi.<acct>.workers.dev --from 2026-09-06 --to 2026-09-21 [--force]
 */
import { addDays, parseYmd, ymd } from "../src/daf/schedule";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const site = (opt("site") ?? "").replace(/\/$/, "");
const token = process.env.ADMIN_TOKEN;
if (!site || !token) { console.error("need --site and ADMIN_TOKEN"); process.exit(2); }
const from = parseYmd(opt("from") ?? ""); const to = parseYmd(opt("to") ?? "");
if (!from || !to) { console.error("need --from and --to (YYYY-MM-DD)"); process.exit(2); }
const force = args.includes("--force");

async function main() {
  for (let d = from!; d <= to!; d = addDays(d, 1)) {
    const url = `${site}/admin/bake?date=${ymd(d)}${force ? "&force=1" : ""}`;
    const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    const body: any = await res.json().catch(() => ({}));
    console.log(`${ymd(d)} ${body.daf ?? ""}: ${res.status} ${body.status ?? ""} ${body.reason ?? ""} ${body.attempts ? `(${body.attempts} attempt/s)` : ""}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
