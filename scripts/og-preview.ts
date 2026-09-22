/**
 * Write a share card's HTML to scratch/ for eyeballing in a browser (or screenshotting with Playwright):
 *   npm run og:preview -- bekhorot/2                       # question and date from the live API
 *   npm run og:preview -- bekhorot/2 --question "Why ...?"  # your own question
 *   npm run og:preview -- --site http://localhost:8787 bekhorot/2
 * Fonts are read from src/og/fonts (same bytes the Worker embeds). Nothing is written to KV.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TRACTATES, tractateBySlug } from "../src/daf/tractates";
import { dafForDate, dateForDaf, parseYmd, todayIn } from "../src/daf/schedule";
import { facesFrom, renderCardHtml } from "../src/og/card";
import { cardModelFor } from "../src/og/bake";
import type { Env } from "../src/types";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--")));
const site = (opt("site") ?? "https://daf-yomi.dev").replace(/\/$/, "");

export function localFonts() {
  const dir = join("src", "og", "fonts");
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { file: string; family: string; style: string; weight: string; unicodeRange: string }[];
  const bytes: Record<string, ArrayBuffer> = {};
  for (const m of manifest) { const b = readFileSync(join(dir, m.file)); bytes[m.file] = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; }
  return facesFrom(manifest, bytes);
}

async function main() {
  const target = positional[0];
  if (!target) { console.error("usage: npm run og:preview -- <slug>/<daf> | YYYY-MM-DD [--question '...'] [--site URL]"); process.exit(2); }
  const today = todayIn("UTC");
  let ref;
  const d = parseYmd(target);
  if (d) ref = dafForDate(d);
  else {
    const [slug, n] = target.split("/");
    const t = tractateBySlug(slug ?? "");
    if (!t || !n) { console.error(`unknown daf ${target}; tractates: ${TRACTATES.map((x) => x.slug).join(", ")}`); process.exit(2); }
    ref = dafForDate(dateForDaf(t, Number(n), dafForDate(today).cycle));
  }
  const date = dateForDaf(ref.tractate, ref.daf, ref.cycle);
  let question = opt("question");
  let generatedAt = "preview";
  if (!question) {
    const res = await fetch(`${site}/api/${ref.tractate.slug}/${ref.daf}.json`);
    const j = (await res.json()) as { note: { question: string; generatedAt: string } | null };
    if (!j.note) { console.error(`no note for ${ref.tractate.slug}/${ref.daf} on ${site}; pass --question`); process.exit(2); }
    question = j.note.question; generatedAt = j.note.generatedAt;
  }
  const env = { SITE_NAME: "Today's Daf", CANONICAL_HOST: "daf-yomi.dev" } as unknown as Env;
  const note = { summary: "", question, quotes: [], model: "preview", promptVersion: "preview", generatedAt, sources: [] };
  const html = renderCardHtml(cardModelFor(env, ref, date, note), localFonts());
  mkdirSync("scratch", { recursive: true });
  const out = join("scratch", `og-${ref.tractate.slug}-${ref.daf}.html`);
  writeFileSync(out, html);
  console.log(`${out}\t${html.length} bytes\t${ref.tractate.name} ${ref.daf}\t"${question}"`);
}

main().catch((e) => { console.error(e); process.exit(1); });
