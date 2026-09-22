/**
 * Audit the stored notes: the current grounding gate over each, the lexical screens (src/note/screen.ts), and the
 * judge (src/note/judge.ts) reading each note against its page through one Message Batch. Writes a committed audit
 * file with a verdict for every daf and the reasons in plain words.
 *
 *   npm run notes:export                                   # first: .cache/notes.json
 *   npm run notes:audit -- --all [--model claude-opus-5]   # text cache (~70 min the first time), then the batch
 *   npm run notes:audit -- --dapim bekhorot/3,shabbat/31   # a few
 *   npm run notes:audit -- --all --review                  # print a spread of verdicts to read
 *   flags: --out data/audit/<date>.json  --limit N  --dry (no judge)  --no-judge
 * Needs ANTHROPIC_API_KEY (env). Resumes: entries already judged in the out file are kept; a batch already submitted
 * for the same request set is polled, not paid for again (.cache/batches/).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { checkNote } from "../src/note/grounding";
import { JudgeSchema, hashJudgePrompt, judgeRequest, verifyJudgment } from "../src/note/judge";
import { hashPrompt } from "../src/note/prompt";
import { screenNote } from "../src/note/screen";
import { estimateUsd } from "../src/note/generate";
import { dateForDaf, ymd } from "../src/daf/schedule";
import { flag, opt, site } from "./lib/cli";
import { parseTargets } from "./lib/targets";
import { pageText } from "./lib/text-cache";
import { runMessageBatch } from "./lib/batch";
import { decide, formatEntry, pickForReview, summarize, type AuditEntry, type AuditFile } from "./lib/audit";
import { utcDay } from "./lib/budget";
import type { NotesExport } from "./export-notes";

const notesPath = opt("notes") ?? ".cache/notes.json";
const out = opt("out") ?? `data/audit/${utcDay()}.json`;
const model = opt("model") ?? "claude-opus-5";
const limit = Number(opt("limit") ?? Infinity);
const noJudge = flag("dry") || flag("no-judge");

async function main() {
  if (!existsSync(notesPath)) { console.error(`no ${notesPath}: run npm run notes:export first`); process.exit(2); }
  const notes = (JSON.parse(readFileSync(notesPath, "utf8")) as NotesExport).notes;
  const targets = parseTargets(opt, flag);
  if (targets.size === 0) { console.error("no targets: use --all, --window N, or --dapim slug/daf"); process.exit(2); }
  const file: AuditFile = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as AuditFile) : { generatedAt: "", site, model, promptVersion: hashPrompt(), judgeVersion: hashJudgePrompt(), counts: {}, estUsd: 0, dapim: {} };
  if (file.judgeVersion !== hashJudgePrompt()) { console.error(`${out} was judged under ${file.judgeVersion}; the judge is now ${hashJudgePrompt()}. Use a new --out.`); process.exit(2); }

  // Phase 1: gate + screens, with the page text on disk.
  const keys = [...targets.keys()].slice(0, limit);
  let n = 0;
  for (const key of keys) {
    const ref = targets.get(key)!;
    const stored = notes[key];
    if (!stored?.note) { console.log(`${key}: no note in the export; skipped`); continue; }
    const existing = file.dapim[key];
    if (existing?.judge && existing.generatedAt === stored.note.generatedAt) continue;
    const { sourceText } = await pageText(ref);
    const s = screenNote(stored.note);
    file.dapim[key] = {
      key, date: ymd(dateForDaf(ref.tractate, ref.daf, ref.cycle)), promptVersion: stored.note.promptVersion, generatedAt: stored.note.generatedAt,
      summary: stored.note.summary, question: stored.note.question,
      screens: s.flags, score: s.score, gate: checkNote(stored.note, sourceText).problems,
      hadTranslation: Boolean(stored.translation), rebake: false, why: [],
    };
    if (++n % 50 === 0) { process.stderr.write(`${n}/${keys.length} screened\n`); save(file); }
  }
  save(file);

  // Phase 2: the judge, one batch.
  const pending = keys.filter((k) => file.dapim[k] && !file.dapim[k]!.judge);
  if (!noJudge && pending.length) {
    if (!process.env.ANTHROPIC_API_KEY) { console.error("the judge needs ANTHROPIC_API_KEY"); process.exit(2); }
    const client = new Anthropic({ maxRetries: 3 });
    const requests = [];
    for (const key of pending) {
      const e = file.dapim[key]!;
      const { input } = await pageText(targets.get(key)!);
      requests.push({ custom_id: key.replace("/", "-"), params: judgeRequest(model, input, { summary: e.summary, question: e.question }) });
    }
    console.log(`judging ${requests.length} note(s) with ${model}`);
    const results = await runMessageBatch(client, `judge-${utcDay()}`, requests, JudgeSchema);
    for (const key of pending) {
      const e = file.dapim[key]!;
      const r = results.get(key.replace("/", "-"));
      if (!r) { e.judgeError = "no result"; continue; }
      const usd = estimateUsd(model, r.usage.inputTokens, r.usage.outputTokens) / 2;
      file.estUsd = Math.round((file.estUsd + usd) * 10000) / 10000;
      if (!r.parsed) { e.judgeError = r.error ?? "no output"; continue; }
      const { sourceText } = await pageText(targets.get(key)!);
      const { judgeVersion: _v, ...j } = verifyJudgment(r.parsed, sourceText);
      e.judge = { ...j, usage: r.usage };
      delete e.judgeError;
    }
  }

  // Phase 3: decide, count, write.
  for (const e of Object.values(file.dapim)) Object.assign(e, decide(e));
  const entries = keys.map((k) => file.dapim[k]).filter((e): e is AuditEntry => Boolean(e));
  file.counts = summarize(Object.values(file.dapim));
  save(file);
  console.log(`\n${out}: ${Object.keys(file.dapim).length} dapim, judge ≈ $${file.estUsd.toFixed(2)} (batch price)`);
  for (const [k, v] of Object.entries(file.counts)) console.log(`  ${k}: ${v}`);
  if (flag("review")) {
    for (const [group, picks] of Object.entries(pickForReview(entries))) {
      console.log(`\n===== ${group} (${picks.length} shown)`);
      for (const e of picks) console.log(formatEntry(e));
    }
  }
}
function save(file: AuditFile) {
  file.generatedAt = new Date().toISOString();
  mkdirSync("data/audit", { recursive: true });
  writeFileSync(out, JSON.stringify(file, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
