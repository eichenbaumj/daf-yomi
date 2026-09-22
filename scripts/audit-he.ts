/**
 * Audit the stored Hebrew notes: the lexical screens (src/note/screenHe.ts) over every translation in .cache/notes.json,
 * and the Hebrew judge (src/note/tjudge.ts) reading each beside its English note through one Message Batch. Writes a
 * committed audit file with a verdict for every daf. The Hebrew counterpart of scripts/audit-notes.ts, a file of its
 * own because that script's shape (the page text, the grounding gate, the English judge's fields) is English through
 * and through. No gate here: the Hebrew gate needs the original text from Sefaria for every daf, and the translations
 * already passed it when they were stored.
 *
 *   npm run notes:export                                          # first: .cache/notes.json
 *   npm run notes:audit:he -- --all [--model claude-opus-5]       # the screens, then the judge batch
 *   npm run notes:audit:he -- --dapim bekhorot/3,bekhorot/4       # a few
 *   npm run notes:audit:he -- --all --review                      # print a spread of verdicts to read
 *   flags: --out data/audit/he-<date>.json  --limit N  --dry (no judge)  --no-judge
 * Stale translations (of an older English bake or an older style) are screened and judged too, and counted as stale:
 * the first audit after a style bump is the baseline. Needs ANTHROPIC_API_KEY (env or .dev.vars). Resumes: entries
 * already judged in the out file are kept; a batch already submitted for the same request set is polled, not paid for
 * again (.cache/batches/).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { TranslationJudgeSchema, hashTranslateJudgePrompt, translationJudgeRequest, verifyTranslationJudgment } from "../src/note/tjudge";
import { hashTranslatePrompt, translationCurrent } from "../src/note/translate";
import { screenTranslation } from "../src/note/screenHe";
import { estimateUsd } from "../src/note/generate";
import { dateForDaf, ymd } from "../src/daf/schedule";
import { anthropicClientOptions, flag, opt, site } from "./lib/cli";
import { parseTargets } from "./lib/targets";
import { runMessageBatch } from "./lib/batch";
import { decideHe, formatEntryHe, pickForReviewHe, summarizeHe, type AuditHeEntry, type AuditHeFile } from "./lib/audit-he";
import { utcDay } from "./lib/budget";
import type { NotesExport } from "./export-notes";

const notesPath = opt("notes") ?? ".cache/notes.json";
const out = opt("out") ?? `data/audit/he-${utcDay()}.json`;
const model = opt("model") ?? "claude-opus-5";
const limit = Number(opt("limit") ?? Infinity);
const noJudge = flag("dry") || flag("no-judge");

async function main() {
  if (!existsSync(notesPath)) { console.error(`no ${notesPath}: run npm run notes:export first`); process.exit(2); }
  const notes = (JSON.parse(readFileSync(notesPath, "utf8")) as NotesExport).notes;
  const targets = parseTargets(opt, flag);
  if (targets.size === 0) { console.error("no targets: use --all, --window N, or --dapim slug/daf"); process.exit(2); }
  const file: AuditHeFile = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as AuditHeFile) : { generatedAt: "", site, model, promptVersion: hashTranslatePrompt("he"), judgeVersion: hashTranslateJudgePrompt(), counts: {}, estUsd: 0, dapim: {} };
  if (file.judgeVersion !== hashTranslateJudgePrompt()) { console.error(`${out} was judged under ${file.judgeVersion}; the judge is now ${hashTranslateJudgePrompt()}. Use a new --out.`); process.exit(2); }

  // Phase 1: the screens over every translation, recomputed every run (cheap, and the rules move); a judge verdict on
  // the same stored translation is kept.
  const keys = [...targets.keys()].slice(0, limit);
  let n = 0, missing = 0;
  for (const key of keys) {
    const ref = targets.get(key)!;
    const stored = notes[key];
    if (!stored?.note || !stored.translation) { missing++; continue; }
    const existing = file.dapim[key];
    const keep = existing?.judge && existing.generatedAt === stored.translation.generatedAt ? { judge: existing.judge } : {};
    const s = screenTranslation(stored.translation);
    file.dapim[key] = {
      key, date: ymd(dateForDaf(ref.tractate, ref.daf, ref.cycle)),
      promptVersion: stored.translation.promptVersion, generatedAt: stored.translation.generatedAt,
      current: translationCurrent(stored.note, stored.translation, "he"),
      summary: stored.translation.summary, question: stored.translation.question,
      english: { summary: stored.note.summary, question: stored.note.question },
      screens: s.flags, score: s.score, rebake: false, why: [], ...keep,
    };
    if (++n % 200 === 0) { process.stderr.write(`${n} screened\n`); save(file); }
  }
  save(file);
  console.log(`${n} translation(s) screened, ${missing} target(s) without one`);

  // Phase 2: the judge, one batch.
  const pending = keys.filter((k) => file.dapim[k] && !file.dapim[k]!.judge);
  if (!noJudge && pending.length) {
    if (!process.env.ANTHROPIC_API_KEY) { console.error("the judge needs ANTHROPIC_API_KEY"); process.exit(2); }
    const client = new Anthropic(anthropicClientOptions());
    const requests = pending.map((key) => {
      const e = file.dapim[key]!;
      const ref = targets.get(key)!;
      return { custom_id: key.replace("/", "-"), params: translationJudgeRequest(model, `${ref.tractate.name} ${ref.daf}`, e.english, { summary: e.summary, question: e.question }) };
    });
    console.log(`judging ${requests.length} translation(s) with ${model}`);
    const results = await runMessageBatch(client, `tjudge-audit-${utcDay()}`, requests, TranslationJudgeSchema);
    for (const key of pending) {
      const e = file.dapim[key]!;
      const r = results.get(key.replace("/", "-"));
      if (!r) { e.judgeError = "no result"; continue; }
      const usd = estimateUsd(model, r.usage.inputTokens, r.usage.outputTokens) / 2;
      file.estUsd = Math.round((file.estUsd + usd) * 10000) / 10000;
      if (!r.parsed) { e.judgeError = r.error ?? "no output"; continue; }
      const { judgeVersion: _v, ...j } = verifyTranslationJudgment(r.parsed, { summary: e.summary, question: e.question }, e.english);
      e.judge = { ...j, usage: r.usage };
      delete e.judgeError;
    }
  }

  // Phase 3: decide, count, write.
  for (const e of Object.values(file.dapim)) Object.assign(e, decideHe(e));
  const entries = keys.map((k) => file.dapim[k]).filter((e): e is AuditHeEntry => Boolean(e));
  file.counts = summarizeHe(Object.values(file.dapim));
  save(file);
  console.log(`\n${out}: ${Object.keys(file.dapim).length} dapim, judge ≈ $${file.estUsd.toFixed(2)} (batch price)`);
  for (const [k, v] of Object.entries(file.counts)) console.log(`  ${k}: ${v}`);
  if (flag("review")) {
    for (const [group, picks] of Object.entries(pickForReviewHe(entries))) {
      console.log(`\n===== ${group} (${picks.length} shown)`);
      for (const e of picks) console.log(formatEntryHe(e));
    }
  }
  const sentBack = entries.filter((e) => e.rebake).map((e) => e.key);
  if (sentBack.length) console.log(`\nnpm run translate -- --site ${site} --lang he --force --dapim ${sentBack.join(",")}`);
}
function save(file: AuditHeFile) {
  file.generatedAt = new Date().toISOString();
  mkdirSync("data/audit", { recursive: true });
  writeFileSync(out, JSON.stringify(file, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
