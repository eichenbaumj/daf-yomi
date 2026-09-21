/**
 * Ask the deployed Worker to render (and optionally send) one issue through the admin endpoint.
 *
 *   npm run newsletter:test -- --site https://daf-yomi.dev --date 2026-09-21 --dry > /tmp/issue.html
 *   npm run newsletter:test -- --site https://daf-yomi.dev --date 2026-09-21 --to you@example.com
 *   npm run newsletter:test -- --site http://localhost:8787 --tick 2026-09-21T10:00:00Z
 *   npm run newsletter:test -- --site https://daf-yomi.dev --status
 *
 * ADMIN_TOKEN comes from the environment or .dev.vars, as for scripts/backfill.ts.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (k: string) => args.includes(`--${k}`);
const site = (opt("site") ?? "http://localhost:8787").replace(/\/$/, "");
function tokenFromDevVars(): string | undefined {
  try { return /^ADMIN_TOKEN=(.+)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1]?.trim(); } catch { return undefined; }
}
const token = process.env.ADMIN_TOKEN ?? tokenFromDevVars();
if (!token) { console.error("need ADMIN_TOKEN (env or .dev.vars)"); process.exit(2); }
const headers = { authorization: `Bearer ${token}` };

async function main() {
  if (flag("status")) {
    const res = await fetch(`${site}/admin/newsletter/status`, { headers });
    console.log(res.status, await res.text());
    return;
  }
  const tick = opt("tick");
  if (tick) {
    const time = Date.parse(tick);
    if (!Number.isFinite(time)) throw new Error(`bad --tick ${tick}`);
    const res = await fetch(`${site}/admin/newsletter/tick?time=${time}`, { method: "POST", headers });
    console.log(res.status, await res.text());
    return;
  }
  const q = new URLSearchParams();
  if (opt("date")) q.set("date", opt("date")!);
  if (opt("variant")) q.set("variant", opt("variant")!);
  if (opt("to")) q.set("to", opt("to")!);
  if (flag("dry")) q.set("dry", "1");
  if (flag("text")) q.set("format", "text");
  const res = await fetch(`${site}/admin/newsletter/send?${q}`, { method: "POST", headers });
  const body = await res.text();
  if (flag("dry")) { process.stderr.write(`${res.status} subject: ${decodeURIComponent(res.headers.get("x-subject") ?? "")}\n`); process.stdout.write(body); }
  else console.log(res.status, body);
}
main().catch((e) => { console.error(e); process.exit(1); });
