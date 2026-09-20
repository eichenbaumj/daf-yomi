/**
 * Verify Hadran's per-daf URL slug for every tractate (HEAD request on the
 * first daf) and record it in data/tractates.json as `hadranSlug`. Tractates
 * with no confirmed slug get no Hadran link on the site.
 *   npm run check:links
 */
import { readFileSync, writeFileSync } from "node:fs";

const UA = "daf-yomi-site link check (joe@group17a.com)";
const data = JSON.parse(readFileSync("data/tractates.json", "utf8"));

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", headers: { "User-Agent": UA } });
    if (!res.ok) return false;
    const finalUrl = res.url.replace(/\/$/, "");
    return finalUrl.endsWith(new URL(url).pathname.replace(/\/$/, ""));
  } catch { return false; }
}

async function main() {
  for (const t of data.tractates) {
    const candidates = [t.slug, t.hebcalName.toLowerCase().replace(/ /g, "-"), t.name.toLowerCase().replace(/ /g, "-").replace("kh", "ch")];
    let found: string | null = null;
    for (const c of [...new Set(candidates)]) {
      if (await exists(`https://hadran.org.il/daf/${c}-${t.firstDaf}/`)) { found = c; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    t.hadranSlug = found ?? undefined;
    console.log(`${t.name}: ${found ?? "— no Hadran page found"}`);
  }
  writeFileSync("data/tractates.json", JSON.stringify(data, null, 1) + "\n");
}
main().catch((e) => { console.error(e); process.exit(1); });
