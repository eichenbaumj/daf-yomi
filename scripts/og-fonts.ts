/**
 * Fetch the web fonts the share card embeds (src/og/card.ts) into src/og/fonts/, with a manifest.
 * Run once, commit the result: `npm run og:fonts`. Re-run when the card needs another face or script.
 *
 * Google Fonts serves one woff2 per (face, unicode-range) block; we keep latin + latin-ext for Source Serif 4
 * (upright and italic; the file is a variable font, so 400 and 600 share it) and hebrew for Frank Ruhl Libre.
 * The card is rendered in Browser Rendering's Chromium, which has none of these installed, and it never fetches
 * over the network, so the bytes travel inside the Worker bundle (wrangler's Data rule) as data: URIs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join("src", "og", "fonts");
const CSS = "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=Frank+Ruhl+Libre:wght@400&display=block";
// A modern browser UA, or Google serves TTF/legacy formats.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

interface Face { family: string; style: "normal" | "italic"; weights: string[]; url: string; unicodeRange: string; subset: string }

function subsetOf(range: string): string | null {
  if (range.startsWith("U+0000-00FF")) return "latin";
  if (range.startsWith("U+0100-02BA")) return "latin-ext";
  if (/U\+0590-05FF/.test(range)) return "hebrew";
  return null;
}

async function main() {
  const css = await (await fetch(CSS, { headers: { "user-agent": UA } })).text();
  const faces = new Map<string, Face>();
  for (const block of css.split("@font-face").slice(1)) {
    const get = (k: string) => /* eslint-disable-line */ new RegExp(`${k}:\\s*([^;]+);`).exec(block)?.[1]?.trim() ?? "";
    const family = get("font-family").replace(/^'|'$/g, "");
    const style = get("font-style") as Face["style"];
    const weight = get("font-weight");
    const url = /url\(([^)]+)\)/.exec(block)?.[1] ?? "";
    const unicodeRange = get("unicode-range");
    const subset = subsetOf(unicodeRange);
    if (!subset || !url) continue;
    if (family === "Frank Ruhl Libre" && subset !== "hebrew") continue;
    const f = faces.get(url);
    if (f) { if (!f.weights.includes(weight)) f.weights.push(weight); continue; }
    faces.set(url, { family, style, weights: [weight], url, unicodeRange, subset });
  }
  if (faces.size === 0) throw new Error("no @font-face blocks parsed; did Google change the CSS?");
  mkdirSync(OUT, { recursive: true });
  const manifest: { file: string; family: string; style: string; weight: string; unicodeRange: string; bytes: number }[] = [];
  for (const f of faces.values()) {
    const slug = `${f.family.toLowerCase().replace(/\s+/g, "-")}-${f.style}-${f.subset}`;
    const file = `${slug}.woff2`;
    const bytes = new Uint8Array(await (await fetch(f.url)).arrayBuffer());
    writeFileSync(join(OUT, file), bytes);
    const ws = f.weights.map(Number).sort((a, b) => a - b);
    const weight = ws.length > 1 ? `${ws[0]} ${ws[ws.length - 1]}` : String(ws[0]);
    manifest.push({ file, family: f.family, style: f.style, weight, unicodeRange: f.unicodeRange, bytes: bytes.byteLength });
    console.log(`${file}\t${bytes.byteLength} bytes\t${f.family} ${f.style} ${weight}`);
  }
  manifest.sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${manifest.length} faces, ${manifest.reduce((a, m) => a + m.bytes, 0)} bytes total`);
}

main().catch((e) => { console.error(e); process.exit(1); });
