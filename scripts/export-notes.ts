/**
 * Read every stored note (and its Hebrew translation) out of the site into .cache/notes.json, through GET /admin/note.
 * Wrangler's bulk get sends every key in one request and Cloudflare caps that at 100, so the admin endpoint it is;
 * 2,711 reads take a few minutes at six in flight and cost nothing (KV reads are not budgeted).
 *
 *   npm run notes:export                          # every daf of the cycle; resumes from the file if it exists
 *   npm run notes:export -- --window 7 --force    # refetch a window
 * Reads ADMIN_TOKEN from the environment or .dev.vars.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { DafNote } from "../src/note/store";
import type { TranslatedNote } from "../src/note/tstore";
import { adminJson, adminToken, flag, opt, pool, site } from "./lib/cli";
import { parseTargets } from "./lib/targets";

export interface Exported { note: DafNote | null; translation: TranslatedNote | null; current: boolean }
export interface NotesExport { exportedAt: string; site: string; notes: Record<string, Exported> }

const path = opt("out") ?? ".cache/notes.json";
const token = adminToken();
let targets = parseTargets(opt, flag);
if (targets.size === 0) targets = parseTargets(() => undefined, (k) => k === "all");

async function main() {
  const file: NotesExport = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as NotesExport) : { exportedAt: "", site, notes: {} };
  if (flag("force")) for (const key of targets.keys()) delete file.notes[key]; // refetch the targets, keep the rest
  const todo = [...targets.entries()].filter(([key]) => !(key in file.notes));
  console.log(`${targets.size} target(s), ${todo.length} to fetch from ${site}`);
  let done = 0;
  await pool(todo, 6, async ([key, ref]) => {
    const { status, body } = await adminJson(token, `/admin/note?slug=${ref.tractate.slug}&daf=${ref.daf}&lang=he`);
    if (status === 401) { console.error("unauthorized: check ADMIN_TOKEN"); process.exit(1); }
    if (status !== 200) { console.log(`${key}: HTTP ${status}`); return; }
    file.notes[key] = { note: body.note ?? null, translation: body.translation ?? null, current: Boolean(body.current) };
    if (++done % 100 === 0) { process.stderr.write(`${done}/${todo.length}\n`); save(file); }
  });
  save(file);
  const entries = Object.values(file.notes);
  const versions: Record<string, number> = {};
  for (const e of entries) if (e.note) versions[e.note.promptVersion] = (versions[e.note.promptVersion] ?? 0) + 1;
  console.log(`${entries.filter((e) => e.note).length} notes, ${entries.filter((e) => !e.note).length} missing, ${entries.filter((e) => e.translation).length} Hebrew translations (${entries.filter((e) => e.current).length} current)`);
  console.log("by style:"); for (const [v, n] of Object.entries(versions).sort()) console.log(`  ${v}: ${n}`);
  console.log(`written to ${path}`);
}
function save(file: NotesExport) {
  file.exportedAt = new Date().toISOString();
  mkdirSync(".cache", { recursive: true });
  writeFileSync(path, JSON.stringify(file));
}
main().catch((e) => { console.error(e); process.exit(1); });
