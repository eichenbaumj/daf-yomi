/**
 * Render the daily issue for a date or a daf, without touching KV or a mailbox.
 *
 *   npm run email:preview -- 2026-09-21 > /tmp/issue.html && open /tmp/issue.html
 *   npm run email:preview -- bekhorot/2 --text
 *   npm run email:preview -- 2026-09-21 --nonote --no-hebrew
 *
 * The note comes from the public API of the live site (--site to point elsewhere);
 * --fixture uses a canned note instead.
 */
import { dafForDate, dateForDaf, parseYmd, type DafRef } from "../src/daf/schedule";
import { tractateBySlug } from "../src/daf/tractates";
import { heldBlock, personalize, renderIssue } from "../src/render/email";
import type { DafNote } from "../src/note/store";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (k: string) => args.includes(`--${k}`);
const target = args.find((a) => !a.startsWith("--") && a !== opt("site")) ?? "";
const site = (opt("site") ?? "https://daf-yomi.dev").replace(/\/$/, "");

function resolve(): { ref: DafRef; date: Date } {
  const asDate = parseYmd(target);
  if (asDate) return { ref: dafForDate(asDate), date: asDate };
  const m = /^([a-z-]+)\/(\d+)$/.exec(target);
  if (m) {
    const t = tractateBySlug(m[1]!);
    if (!t) throw new Error(`unknown tractate ${m[1]}`);
    const today = dafForDate(new Date());
    const date = dateForDaf(t, Number(m[2]), today.cycle);
    return { ref: dafForDate(date), date };
  }
  const today = new Date();
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return { ref: dafForDate(date), date };
}

async function loadNote(ref: DafRef): Promise<DafNote | null> {
  if (flag("nonote")) return null;
  if (flag("fixture")) return { summary: "A sample summary in three sentences. It names the concrete case the page argues about. Then it points at the one move worth noticing.", question: "Is the question the page leaves open really open?", quotes: [], model: "fixture", promptVersion: "fixture", generatedAt: new Date().toISOString(), sources: [], wordCount: 3300 };
  const res = await fetch(`${site}/api/${ref.tractate.slug}/${ref.daf}.json`);
  if (!res.ok) throw new Error(`${res.status} from ${site}`);
  const body = (await res.json()) as { note: { summary: string; question: string; model: string; generatedAt: string } | null };
  if (!body.note) return null;
  return { summary: body.note.summary, question: body.note.question, quotes: [], model: body.note.model, promptVersion: "live", generatedAt: body.note.generatedAt, sources: [] };
}

async function main() {
  const { ref, date } = resolve();
  const note = await loadNote(ref);
  const r = renderIssue({ origin: site, siteName: "Today's Daf", ref, date, note, hebrew: !flag("no-hebrew") });
  const held = flag("held") ? heldBlock(site, [{ date: new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1), ref: dafForDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1)) }]) : { html: "", text: "" };
  const p = personalize(r, { unsubUrl: `${site}/newsletter/u/${"0".repeat(48)}`, prefsUrl: `${site}/newsletter/prefs/${"0".repeat(48)}`, email: "you@example.com", confirmedDate: "Sunday, 20 September 2026", heldHtml: held.html, heldText: held.text });
  process.stderr.write(`subject: ${p.subject}\npreheader: ${p.preheader}\nhtml: ${p.html.length} bytes, text: ${p.text.length} bytes\n`);
  process.stdout.write(flag("text") ? p.text : p.html);
}
main().catch((e) => { console.error(e); process.exit(1); });
