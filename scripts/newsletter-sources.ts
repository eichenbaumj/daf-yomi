/**
 * Confirmed subscribers by campaign tag, from the deployed Worker's admin status endpoint.
 *
 *   npm run newsletter:sources
 *   npm run newsletter:sources -- --site http://localhost:8787
 *   npm run newsletter:sources -- --json
 *
 * The tag is the `?src=` word on a paid link (see src/newsletter/source.ts). Google Ads reports clicks and spend
 * per ad group; this prints the other half. Cost per confirmed subscriber is the division between the two.
 * Reads ADMIN_TOKEN from the environment or .dev.vars.
 */
import { adminJson, adminToken, flag } from "./lib/cli";

interface SourceRow { active: number; unsubscribed: number; confirmed7d: number; confirmed30d: number }

async function main() {
  const { status, body } = await adminJson(adminToken(), "/admin/newsletter/status");
  if (status !== 200) { console.error(`status ${status}: ${JSON.stringify(body)}`); process.exit(1); }
  const sources = (body.sources ?? {}) as Record<string, SourceRow>;
  if (flag("json")) { console.log(JSON.stringify(sources, null, 2)); return; }
  const rows = Object.entries(sources).sort((a, b) => b[1].confirmed30d - a[1].confirmed30d || b[1].active - a[1].active || a[0].localeCompare(b[0]));
  if (!rows.length) { console.log("no subscribers"); return; }
  const w = Math.max(6, ...rows.map(([k]) => k.length));
  console.log(`${"source".padEnd(w)}  active  unsub  last7d  last30d`);
  for (const [k, r] of rows) console.log(`${k.padEnd(w)}  ${String(r.active).padStart(6)}  ${String(r.unsubscribed).padStart(5)}  ${String(r.confirmed7d).padStart(6)}  ${String(r.confirmed30d).padStart(7)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
