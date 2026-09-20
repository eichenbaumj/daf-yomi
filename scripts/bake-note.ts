/**
 * Style iteration: write a note for one or more dapim locally and print it,
 * with the grounding check's verdict. Does not touch KV.
 *
 *   ANTHROPIC_API_KEY=... npm run bake:note -- bekhorot/2 berakhot/2 2026-09-21
 *   npm run bake:note -- --model claude-opus-5 --dump prompt bekhorot/2
 */
import { dafForDate, dateForDaf, parseYmd } from "../src/daf/schedule";
import { tractateBySlug } from "../src/daf/tractates";
import { buildPromptInput, draftNote } from "../src/note/generate";
import { checkNote } from "../src/note/grounding";
import { SYSTEM_PROMPT, hashPrompt, userMessage } from "../src/note/prompt";
import Anthropic from "@anthropic-ai/sdk";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const targets = args.filter((a: string, i: number) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--")));
const model = opt("model") ?? "claude-opus-5";
const dump = opt("dump");

function refFor(target: string) {
  const today = new Date();
  const cycle = dafForDate(new Date(today.getFullYear(), today.getMonth(), today.getDate())).cycle;
  const d = parseYmd(target);
  if (d) return dafForDate(d);
  const m = /^([a-z-]+)\/(\d+)$/.exec(target);
  if (!m) throw new Error(`bad target ${target}; use slug/daf or YYYY-MM-DD`);
  const t = tractateBySlug(m[1]!); if (!t) throw new Error(`unknown tractate ${m[1]}`);
  return dafForDate(dateForDaf(t, Number(m[2]), cycle));
}

async function main() {
  if (targets.length === 0) { console.error("give at least one target: slug/daf or YYYY-MM-DD"); process.exit(2); }
  console.log(`style ${hashPrompt()} · model ${model}\n`);
  const client = new Anthropic();
  for (const target of targets) {
    const ref = refFor(target);
    const { input, sourceText } = await buildPromptInput(ref);
    console.log(`━━━ ${ref.tractate.name} ${ref.daf} · ${input.positionLine} · ${sourceText.split(/\s+/).length} source words`);
    if (dump === "prompt") { console.log("--- system ---\n" + SYSTEM_PROMPT + "\n--- user ---\n" + userMessage(input)); continue; }
    if (dump === "text") { console.log(sourceText); continue; }
    const { draft, refusal } = await draftNote(client, model, input);
    if (!draft) { console.log(`  no draft (${refusal ?? "unparseable"})`); continue; }
    console.log(`\n${draft.summary}\n\n${draft.question}\n`);
    if (draft.quotes.length) console.log(`quotes: ${draft.quotes.map((q) => `"${q}"`).join(" · ")}`);
    const check = checkNote(draft, sourceText);
    console.log(check.ok ? "✓ grounding passed" : `✗ grounding: ${check.problems.join(" | ")}`);
    console.log();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
