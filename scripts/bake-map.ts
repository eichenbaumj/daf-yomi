/**
 * Style iteration for the map of the page: draw the map for one or more dapim locally and print it, with the
 * gate's verdict. Does not touch KV.
 *
 *   npm run bake:map -- bekhorot/4 berakhot/2 2026-09-23
 *   npm run bake:map -- --model claude-opus-5 --dump prompt|text|cues bekhorot/4
 *   npm run bake:map -- --json bekhorot/4        (the draft as one JSON line, for a review file)
 */
import Anthropic from "@anthropic-ai/sdk";
import { dafForDate, dateForDaf, parseYmd } from "../src/daf/schedule";
import { tractateBySlug } from "../src/daf/tractates";
import { MARK_WORD } from "../src/map/cues";
import { buildMapInput, draftMap } from "../src/map/generate";
import { checkMap } from "../src/map/gate";
import { hashMapPrompt, MAP_SYSTEM, mapUserMessage } from "../src/map/prompt";
import { estimateUsd } from "../src/note/generate";
import { anthropicClientOptions } from "./lib/cli";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (k: string) => args.includes(`--${k}`);
const targets = args.filter((a: string, i: number) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--") && !["--json"].includes(args[i - 1]!)));
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
  console.log(`map style ${hashMapPrompt()} · model ${model}\n`);
  const client = new Anthropic(anthropicClientOptions());
  let total = 0;
  for (const target of targets) {
    const ref = refFor(target);
    const { input, sourceText } = await buildMapInput(ref);
    const segments = input.sections.reduce((n, s) => n + s.segments.length, 0);
    const cues = input.cues.map((c) => `${c.id} (${MARK_WORD[c.mark]})`).join(", ") || "none";
    console.log(`━━━ ${ref.tractate.name} ${ref.daf} · ${input.positionLine} · ${segments} segments · ${sourceText.split(/\s+/).length} words · marks: ${cues}`);
    if (dump === "prompt") { console.log("--- system ---\n" + MAP_SYSTEM + "\n--- user ---\n" + mapUserMessage(input)); continue; }
    if (dump === "text") { console.log(sourceText); continue; }
    if (dump === "cues") { continue; }
    const { draft, refusal, usage } = await draftMap(client, model, input);
    const usd = estimateUsd(model, usage.inputTokens, usage.outputTokens);
    total += usd;
    console.log(`tokens: ${usage.inputTokens} in / ${usage.outputTokens} out ≈ $${usd.toFixed(3)}`);
    if (!draft) { console.log(`  no draft (${refusal ?? "unparseable"})`); continue; }
    console.log(`\nSHAPE  ${draft.shape}\n`);
    for (const [i, u] of draft.units.entries()) {
      console.log(`${String(i + 1).padStart(2)}. ${`${u.from}..${u.to}`.padEnd(11)} ${u.kind.padEnd(10)} ${u.title}\n    ${u.gloss}`);
    }
    const check = checkMap(draft, input, sourceText);
    console.log(check.ok ? "\n✓ gate passed" : `\n✗ gate: ${check.problems.join(" | ")}`);
    if (flag("json")) console.log(JSON.stringify({ daf: `${ref.tractate.slug}/${ref.daf}`, ...draft }));
    console.log();
  }
  console.log(`estimated total ≈ $${total.toFixed(2)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
