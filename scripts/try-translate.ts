/**
 * Style iteration for the Hebrew note: translate one or more stored English notes here and print the Hebrew, with the
 * gate's verdict, the lexical screens (src/note/screenHe.ts) and, with --judge, the Hebrew judge's reading
 * (src/note/tjudge.ts). Prints only; never stores anything.
 *
 *   npm run translate:try -- bekhorot/3 bekhorot/4 [--judge] [--local] [--model claude-opus-5] [--judge-model m]
 *   npm run translate:try -- --dump prompt bekhorot/4
 *
 * The English note (and the stored Hebrew, for comparison) comes from GET /admin/note on the site (ADMIN_TOKEN from the
 * environment or .dev.vars), or with --local from .cache/notes.json (npm run notes:export). The aligned page text comes
 * from Sefaria. Needs ANTHROPIC_API_KEY (env or .dev.vars) unless --dump prompt.
 */
import { existsSync, readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import type { DafRef } from "../src/daf/schedule";
import { buildTranslateInput, checkTranslation, draftTranslation, hashTranslatePrompt, systemPrompt, translateUserMessage, translationCurrent } from "../src/note/translate";
import { hashTranslateJudgePrompt, judgeTranslation } from "../src/note/tjudge";
import { screenLabelHe, screenTranslation } from "../src/note/screenHe";
import { estimateUsd } from "../src/note/generate";
import type { DafNote } from "../src/note/store";
import type { TranslatedNote } from "../src/note/tstore";
import { adminJson, adminToken, anthropicClientOptions, args, flag, opt } from "./lib/cli";
import { refForKey } from "./lib/targets";
import type { NotesExport } from "./export-notes";

/** Options that take a value; anything else that is not a flag is a target. */
const VALUED = new Set(["model", "judge-model", "dump", "site", "notes"]);
const targets = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.has(args[i - 1]!.replace(/^--/, ""))));
const model = opt("model") ?? "claude-opus-5";
const judgeModel = opt("judge-model") ?? model;
const dump = opt("dump");
const withJudge = flag("judge");
const local = flag("local");
const notesPath = opt("notes") ?? ".cache/notes.json";

interface Stored { note: DafNote | null; translation: TranslatedNote | null }

function localStored(key: string): Stored {
  if (!existsSync(notesPath)) { console.error(`no ${notesPath}: run npm run notes:export first, or drop --local`); process.exit(2); }
  const e = (JSON.parse(readFileSync(notesPath, "utf8")) as NotesExport).notes[key];
  return { note: e?.note ?? null, translation: e?.translation ?? null };
}
async function siteStored(token: string, ref: DafRef): Promise<Stored> {
  const { status, body } = await adminJson(token, `/admin/note?slug=${ref.tractate.slug}&daf=${ref.daf}&lang=he`);
  if (status === 401) { console.error("unauthorized: check ADMIN_TOKEN"); process.exit(1); }
  if (status !== 200) { console.log(`HTTP ${status} from /admin/note`); return { note: null, translation: null }; }
  return { note: body.note ?? null, translation: body.translation ?? null };
}

async function main() {
  if (targets.length === 0) { console.error("give at least one target: slug/daf"); process.exit(2); }
  console.log(`style ${hashTranslatePrompt("he")} · judge ${hashTranslateJudgePrompt()} · model ${model}${withJudge ? ` · judge model ${judgeModel}` : ""}\n`);
  const token = local ? null : adminToken();
  const client = dump ? null : new Anthropic(anthropicClientOptions());
  let totalUsd = 0;
  for (const target of targets) {
    const ref = refForKey(target);
    const key = `${ref.tractate.slug}/${ref.daf}`;
    const { note, translation } = local ? localStored(key) : await siteStored(token!, ref);
    if (!note) { console.log(`━━━ ${key}: no English note; skipped\n`); continue; }
    const { input, heSource } = await buildTranslateInput(ref, "he", note);
    console.log(`━━━ ${ref.tractate.name} ${ref.daf} · English note of ${note.generatedAt} (style ${note.promptVersion})`);
    console.log(`${note.summary}\n${note.question}\n`);
    if (translation) {
      console.log(`stored Hebrew (style ${translation.promptVersion}, ${translationCurrent(note, translation, "he") ? "current" : "retired"}${translation.review ? `; judged ${translation.review.verdict}, naturalness ${translation.review.naturalness}` : ""}):`);
      console.log(`${translation.summary}\n${translation.question}\n`);
    }
    if (dump === "prompt") { console.log("--- system ---\n" + systemPrompt("he") + "\n--- user ---\n" + translateUserMessage(input) + "\n"); continue; }
    const { draft, refusal, usage } = await draftTranslation(client!, model, input);
    let usd = estimateUsd(model, usage.inputTokens, usage.outputTokens);
    console.log(`tokens: ${usage.inputTokens} in / ${usage.outputTokens} out`);
    if (!draft) { console.log(`  no draft (${refusal ?? "unparseable"})\n`); totalUsd += usd; continue; }
    console.log(`\n${draft.summary}\n\n${draft.question}\n`);
    if (draft.quotes.length) console.log(`quotes: ${draft.quotes.map((q) => `"${q}"`).join(" · ")}`);
    const check = checkTranslation(draft, heSource, note);
    console.log(check.ok ? "✓ gate passed" : `✗ gate: ${check.problems.join(" | ")}`);
    console.log(`screens: ${screenLabelHe(screenTranslation(draft))}`);
    if (withJudge) {
      const j = await judgeTranslation(client!, judgeModel, input.label, note, draft);
      usd += estimateUsd(judgeModel, j.usage.inputTokens, j.usage.outputTokens);
      if (!j.judgment) console.log(`judge: no verdict (${j.refusal ?? "unknown"})`);
      else {
        const jd = j.judgment;
        console.log(`judge: naturalness ${jd.naturalness}/5, ${jd.verdict}${jd.reasons.length ? ` (${jd.reasons.join(", ")})` : ""}${jd.sameQuestion ? "" : "; not the same question"}${jd.unverified ? "; a span the judge quoted is not in the text and was discounted" : ""}`);
        for (const f of jd.fidelity) console.log(`  fidelity: "${f.hebrew}" for "${f.english}": ${f.problem}`);
        for (const l of jd.language) console.log(`  ${l.kind}: "${l.hebrew}" → "${l.better}"`);
        if (jd.feedback) console.log(`  feedback: ${jd.feedback}`);
      }
    }
    totalUsd += usd;
    console.log(`≈ $${usd.toFixed(3)} list\n`);
  }
  console.log(`estimated total ≈ $${totalUsd.toFixed(2)} list`);
}
main().catch((e) => { console.error(e); process.exit(1); });
