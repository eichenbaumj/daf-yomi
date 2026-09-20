/**
 * Bake data/tractates.json: the 40-row Daf Yomi table (37 tractates plus
 * Kinnim/Tamid/Middot, which the schedule counts separately) joined to
 * Sefaria's index metadata (Hebrew titles, Seder, chapter ranges, blurbs) and
 * the list of Steinsaltz introductions Sefaria carries per tractate.
 *
 * Schedule lengths come from @hebcal/learning's table (public domain port of
 * daf.el), which is what the site uses at runtime, so the two can't drift.
 * Run: npm run build:tractates   (network: ~45 Sefaria requests)
 */
import { writeFileSync } from "node:fs";
import { TRACTATE_NAMES, TRACTATE_LAST_DAF, DAF_OFFSETS } from "@hebcal/learning/dafYomiBase";
import { dafYomiSefaria } from "@hebcal/learning/DafPageEvent";

const UA = "daf-yomi-site build script (joe@group17a.com)";
const SEFARIA = "https://www.sefaria.org";

/** hebcal name → Sefaria index title. hebcal's own map covers most; these are the schedule oddities. */
const SEFARIA_TITLE: Record<string, string> = {
  ...(dafYomiSefaria as Record<string, string>),
  Shekalim: "Jerusalem Talmud Shekalim",
  Kinnim: "Mishnah Kinnim",
  Midot: "Mishnah Middot",
};
/** Tractates whose Sefaria ref for a given daf is not `{Title}.{n}a`; resolved via Sefaria's calendar at runtime. */
const CALENDAR_REF = new Set(["Shekalim", "Kinnim", "Midot"]);

interface Chapter { n: number; title: string; heTitle: string; startDaf: string; endDaf: string }
export interface TractateRow {
  hebcalName: string; sefariaTitle: string; name: string; slug: string; heTitle: string;
  seder: string; sederHe: string; order: number; firstDaf: number; lastDaf: number; days: number;
  refMode: "talmud" | "calendar"; shortDesc: string; description: string;
  /** Side the tractate ends on. Sefaria numbers amudim 1a=1, 1b=2, 2a=3 …, so an odd count ends on side a. */
  lastAmud: "a" | "b";
  chapters: Chapter[]; introNodes: string[];
}

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${SEFARIA}${path}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

function displayName(sefariaTitle: string): string {
  return sefariaTitle.replace(/^Jerusalem Talmud /, "").replace(/^Mishnah /, "");
}
function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function parseChapter(node: any, n: number): Chapter | null {
  const whole: string = node.wholeRef ?? "";
  const m = whole.match(/(\d+[ab])(?::\d+)?-(?:[A-Za-z' ]+ )?(\d+[ab])/);
  if (!m) return null;
  const title = String(node.title ?? "").replace(/^Chapter \d+;\s*/, "");
  return { n, title, heTitle: String(node.heTitle ?? ""), startDaf: m[1]!, endDaf: m[2]! };
}

async function main() {
  const intros = await getJson("/api/v2/index/Introductions_to_the_Babylonian_Talmud");
  const introByTitle = new Map<string, string[]>();
  for (const node of intros.schema.nodes ?? []) {
    introByTitle.set(node.title, (node.nodes ?? []).map((c: any) => String(c.title)));
  }

  const rows: TractateRow[] = [];
  for (let i = 0; i < TRACTATE_NAMES.length; i++) {
    const hebcalName = TRACTATE_NAMES[i]!;
    const lastDaf = TRACTATE_LAST_DAF[i]! + ((DAF_OFFSETS as Record<number, number>)[i] ?? 0);
    const firstDaf = 2 + ((DAF_OFFSETS as Record<number, number>)[i] ?? 0);
    const sefariaTitle = SEFARIA_TITLE[hebcalName] ?? hebcalName;
    const idx = await getJson(`/api/v2/index/${sefariaTitle.replace(/ /g, "_")}`);
    if (idx.error) throw new Error(`${sefariaTitle}: ${idx.error}`);
    const cats: string[] = idx.categories ?? [];
    const heCats: string[] = idx.heCategories ?? [];
    const sederIx = cats.findIndex((c) => c.startsWith("Seder"));
    const chapterNodes: any[] = idx.alts?.Chapters?.nodes ?? [];
    const chapters = CALENDAR_REF.has(hebcalName)
      ? []
      : chapterNodes.map((n, k) => parseChapter(n, k + 1)).filter((c): c is Chapter => !!c);
    const name = displayName(sefariaTitle);
    const amudim: number | undefined = idx.schema?.lengths?.[0];
    const lastAmud: "a" | "b" = CALENDAR_REF.has(hebcalName) ? "b" : amudim && amudim % 2 === 0 ? "b" : "a";
    if (!CALENDAR_REF.has(hebcalName) && amudim && Math.ceil(amudim / 2) !== lastDaf) throw new Error(`${name}: Sefaria has ${amudim} amudim (last daf ${Math.ceil(amudim / 2)}) but the schedule ends at ${lastDaf}`);
    rows.push({
      hebcalName, sefariaTitle, name, slug: slugOf(name), heTitle: String(idx.heTitle ?? "").replace(/^(משנה|תלמוד ירושלמי)\s+/, ""),
      seder: sederIx >= 0 ? cats[sederIx]! : "", sederHe: sederIx >= 0 ? heCats[sederIx] ?? "" : "",
      order: i, firstDaf, lastDaf, days: lastDaf - firstDaf + 1,
      refMode: CALENDAR_REF.has(hebcalName) ? "calendar" : "talmud", lastAmud,
      shortDesc: String(idx.enShortDesc ?? ""), description: String(idx.enDesc ?? ""),
      chapters, introNodes: introByTitle.get(sefariaTitle) ?? [],
    });
    process.stderr.write(`${name}: ${firstDaf}–${lastDaf}${lastAmud} (${lastDaf - firstDaf + 1}d), ${chapters.length} ch, ${(introByTitle.get(sefariaTitle) ?? []).length} intro nodes\n`);
  }
  const total = rows.reduce((s, r) => s + r.days, 0);
  if (total !== 2711) throw new Error(`days sum to ${total}, expected 2711`);
  const slugs = new Set(rows.map((r) => r.slug));
  if (slugs.size !== rows.length) throw new Error("duplicate slugs");
  writeFileSync("data/tractates.json", JSON.stringify({ generatedAt: new Date().toISOString(), cycleLength: total, tractates: rows }, null, 1) + "\n");
  process.stderr.write(`wrote data/tractates.json: ${rows.length} rows, ${total} days\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
