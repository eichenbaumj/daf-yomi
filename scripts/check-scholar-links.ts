/**
 * Verify the per-daf URL slugs of the teaching sites the "Go deeper" box links to, and record them in
 * data/tractates.json. Each probe is a GET on the tractate's first daf; a redirect to some other page
 * does not count. Tractates with no confirmed slug get no per-daf link on the site (Hadran: no link at
 * all; My Jewish Learning: the series page instead).
 *
 * My Jewish Learning publishes an article per daf on the morning of that daf, so a tractate the cycle
 * has not reached yet cannot be confirmed; re-run this once it starts.
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

const pause = () => new Promise((r) => setTimeout(r, 200));

async function firstSlug(candidates: string[], urlFor: (slug: string) => string): Promise<string | undefined> {
  for (const c of [...new Set(candidates)]) {
    if (await exists(urlFor(c))) return c;
    await pause();
  }
  return undefined;
}

async function main() {
  for (const t of data.tractates) {
    const candidates = [t.slug, t.hebcalName.toLowerCase().replace(/ /g, "-"), t.name.toLowerCase().replace(/ /g, "-"), t.name.toLowerCase().replace(/ /g, "-").replace("kh", "ch")];
    const hadran = await firstSlug(candidates, (c) => `https://hadran.org.il/daf/${c}-${t.firstDaf}/`);
    const mjl = await firstSlug(candidates, (c) => `https://www.myjewishlearning.com/article/${c}-${t.firstDaf}/`);
    if (hadran) t.hadranSlug = hadran; else delete t.hadranSlug;
    if (mjl) t.mjlSlug = mjl; else delete t.mjlSlug;
    console.log(`${t.name}: hadran=${hadran ?? "none"} mjl=${mjl ?? "none (not reached yet?)"}`);
  }
  writeFileSync("data/tractates.json", JSON.stringify(data, null, 1) + "\n");
}
main().catch((e) => { console.error(e); process.exit(1); });
