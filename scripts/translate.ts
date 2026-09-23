/**
 * Translate stored English notes into another language.
 *
 *   npm run translate -- --site https://daf-yomi.dev --lang he --window 7 [--dapim berakhot/2,shabbat/31] [--all]
 *                        [--mode batch|worker] [--force] [--dry] [--no-judge] [--model m] [--judge-model m]
 *
 * Targets: --window N (today ± N days), --dapim slug/daf[,…], --rest (the rest of this cycle, from tomorrow), --all
 * (every daf of the cycle). They add up.
 * Modes:
 *   worker  POST /admin/translate per daf: the Worker calls Claude, checks, judges and stores. Simple; fine for a window.
 *   batch   (default) Reads each English note from GET /admin/note and the aligned text from Sefaria, sends every
 *           request in one Message Batch (half price, hours not seconds), checks each result locally with the same
 *           checkTranslation the Worker runs, sends the drafts that pass to the Hebrew judge (src/note/tjudge.ts) in a
 *           second batch, POSTs the kept ones to /admin/translate/put (which checks again and refuses stale ones) with
 *           the judge's review, and drafts once more with the feedback for the ones the gate or the judge sent back.
 *           At most three drafts and one judge reading per daf, the Worker's own bound; a draft the judge sent back
 *           when no draft was left is stored anyway with its review saying so. Batch ids live in .cache/batches/, so a
 *           rerun the same day with the same targets polls instead of paying again.
 * Needs ADMIN_TOKEN (env or .dev.vars) for the site and ANTHROPIC_API_KEY (env or .dev.vars) for batch mode.
 * KV note: each stored translation is one KV write (free plan: 1,000 a day).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { DafRef } from "../src/daf/schedule";
import { buildTranslateInput, checkTranslation, hashTranslatePrompt, systemPrompt, translateUserMessage, TranslationSchema, type TranslatableLang, type TranslateInput, type TranslationDraft } from "../src/note/translate";
import { TranslationJudgeSchema, translationJudgeRequest, verifyTranslationJudgment, type TranslationJudgment } from "../src/note/tjudge";
import { screenLabelHe, screenTranslation } from "../src/note/screenHe";
import { estimateUsd } from "../src/note/generate";
import type { DafNote } from "../src/note/store";
import { adminJson, adminToken, anthropicClientOptions, flag, opt, site } from "./lib/cli";
import { parseTargets } from "./lib/targets";
import { runMessageBatch } from "./lib/batch";
import { utcDay } from "./lib/budget";

const lang = (opt("lang") ?? "he") as TranslatableLang;
const mode = opt("mode") ?? "batch";
const model = opt("model") ?? "claude-opus-5";
const judgeModel = opt("judge-model") ?? model;
const force = flag("force");
const dry = flag("dry");
const noJudge = flag("no-judge");
const token = adminToken();
if (lang !== "he") { console.error("only --lang he has a style guide today"); process.exit(2); }

const targets = parseTargets(opt, flag);
if (targets.size === 0) { console.error("no targets: use --window N, --dapim slug/daf, or --all"); process.exit(2); }
console.log(`${targets.size} target(s), lang ${lang}, mode ${mode}, site ${site}${force ? ", force" : ""}${dry ? ", dry run" : ""}${noJudge ? ", no judge" : ""}`);

let totalUsd = 0;
const admin = (path: string, init: RequestInit = {}) => adminJson(token, path, init);

// ---- worker mode: the Worker does everything, one call per daf ----
async function runWorker() {
  for (const [key, ref] of targets) {
    if (dry) { console.log(`${key}: would POST /admin/translate`); continue; }
    const { status, body } = await admin(`/admin/translate?slug=${ref.tractate.slug}&daf=${ref.daf}&lang=${lang}${force ? "&force=1" : ""}${noJudge ? "&judge=off" : ""}`, { method: "POST" });
    const u = body.translation?.usage;
    if (u) totalUsd += u.estUsd;
    const j = body.judged;
    console.log(`${key}: ${status} ${body.status ?? ""} ${body.reason ?? ""}${body.attempts ? ` (${body.attempts} attempt/s)` : ""}${j ? `; judge: ${j.verdict}, naturalness ${j.naturalness}${j.reasons?.length ? ` (${j.reasons.join(", ")})` : ""}` : ""}${u ? ` ${u.inputTokens} in / ${u.outputTokens} out ≈ $${u.estUsd.toFixed(3)}` : ""}`);
    for (const p of [...(body.firstAttemptProblems ?? []), ...(body.problems ?? [])]) console.log(`    ↳ ${p}`);
    if (body.lastDraft) console.log(`    rejected draft: ${body.lastDraft.summary}\n    Q: ${body.lastDraft.question}`);
  }
}

// ---- batch mode ----
const MAX_DRAFTS = noJudge ? 2 : 3;
interface Job {
  key: string; ref: DafRef; note: DafNote; input: TranslateInput; heSource: string;
  feedback?: string; drafts: number; inputTokens: number; outputTokens: number;
  draft?: TranslationDraft; judgment?: TranslationJudgment; judged: boolean; rewritten: boolean;
  state: "draft" | "judge" | "ready" | "given-up"; reason?: string;
}
const cid = (j: Job) => j.key.replace("/", "-");
const usd = (j: Job) => Math.round((estimateUsd(model, j.inputTokens, j.outputTokens) / 2) * 10000) / 10000; // batch price
function giveUp(j: Job, reason: string) { j.state = "given-up"; j.reason = reason; console.log(`${j.key}: given up: ${reason}`); }

async function collectJobs(): Promise<Job[]> {
  const jobs: Job[] = [];
  const version = hashTranslatePrompt(lang);
  for (const [key, ref] of targets) {
    const { status, body } = await admin(`/admin/note?slug=${ref.tractate.slug}&daf=${ref.daf}&lang=${lang}`);
    if (status === 401) { console.error("unauthorized: check ADMIN_TOKEN"); process.exit(1); }
    if (status !== 200 || !body.note) { console.log(`${key}: no English note (${status}); skipped`); continue; }
    const note = body.note as DafNote;
    if (!force && body.translation && body.translation.of === note.generatedAt && body.translation.promptVersion === version) { console.log(`${key}: translation is current; skipped`); continue; }
    const { input, heSource } = await buildTranslateInput(ref, lang, note);
    jobs.push({ key, ref, note, input, heSource, drafts: 0, inputTokens: 0, outputTokens: 0, judged: false, rewritten: false, state: "draft" });
  }
  return jobs;
}

/** One draft batch: every job in `jobs` gets a draft, then the gate. */
async function draftRound(client: Anthropic, jobs: Job[], round: number) {
  const requests = jobs.map((j) => ({
    custom_id: cid(j),
    params: { model, max_tokens: 4000, system: systemPrompt(lang), messages: [{ role: "user" as const, content: translateUserMessage({ ...j.input, feedback: j.feedback }) }], output_config: { format: zodOutputFormat(TranslationSchema) } },
  }));
  const results = await runMessageBatch(client, `translate-${lang}-${utcDay()}-r${round}`, requests, TranslationSchema);
  for (const j of jobs) {
    const r = results.get(cid(j));
    j.drafts++;
    if (r) { j.inputTokens += r.usage.inputTokens; j.outputTokens += r.usage.outputTokens; }
    if (!r?.parsed) {
      if (r?.error === "refused" || j.drafts >= MAX_DRAFTS) { giveUp(j, `draft ${j.drafts}: ${r?.error ?? "no result"}`); continue; }
      if (r?.error === "unparseable output") j.feedback = "Return only the structured fields.";
      continue;
    }
    const check = checkTranslation(r.parsed, j.heSource, j.note);
    if (check.ok) { j.draft = r.parsed; j.state = j.judged || noJudge ? "ready" : "judge"; continue; }
    console.log(`${j.key}: draft ${j.drafts} failed the gate: ${check.problems.join(" | ")}\n    draft: ${r.parsed.summary}\n    Q: ${r.parsed.question}`);
    if (j.drafts >= MAX_DRAFTS) { giveUp(j, `gate after ${j.drafts} drafts: ${check.problems.join(" | ")}`); continue; }
    j.feedback = check.problems.join(" ");
  }
}

/** One judge batch over drafts that passed the gate. A job is judged once; a rewrite is never judged again. */
async function judgeRound(client: Anthropic, jobs: Job[], round: number) {
  const requests = jobs.map((j) => ({ custom_id: cid(j), params: translationJudgeRequest(judgeModel, j.input.label, j.note, j.draft!) }));
  const results = await runMessageBatch(client, `tjudge-${lang}-${utcDay()}-r${round}`, requests, TranslationJudgeSchema);
  for (const j of jobs) {
    const r = results.get(cid(j));
    j.judged = true;
    if (r) { j.inputTokens += r.usage.inputTokens; j.outputTokens += r.usage.outputTokens; }
    const screens = screenLabelHe(screenTranslation(j.draft!));
    if (!r?.parsed) { console.log(`${j.key}: judge gave no verdict (${r?.error ?? "no result"}); keeping the draft that passed the gate; screens: ${screens}`); j.state = "ready"; continue; }
    const jd = verifyTranslationJudgment(r.parsed, j.draft!, j.note);
    j.judgment = jd;
    console.log(`${j.key}: judge: naturalness ${jd.naturalness}, ${jd.verdict}${jd.reasons.length ? ` (${jd.reasons.join(", ")})` : ""}${jd.unverified ? ", a span discounted" : ""}; screens: ${screens}`);
    if (jd.verdict === "keep") { j.state = "ready"; continue; }
    console.log(`    ${jd.feedback}`);
    // Out of drafts: stored anyway, and its review says the judge sent it back (the Worker's rule).
    if (j.drafts >= MAX_DRAFTS) { j.state = "ready"; continue; }
    j.rewritten = true; j.feedback = jd.feedback; j.state = "draft";
  }
}

async function runBatch() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("batch mode needs ANTHROPIC_API_KEY"); process.exit(2); }
  const client = new Anthropic(anthropicClientOptions());
  const jobs = await collectJobs();
  console.log(`${jobs.length} to translate`);
  if (dry) { for (const j of jobs) console.log(`--- ${j.key}\n${translateUserMessage(j.input).slice(0, 1500)}\n…`); return; }
  for (let round = 1; jobs.some((j) => j.state === "draft" || j.state === "judge"); round++) {
    const drafting = jobs.filter((j) => j.state === "draft");
    if (drafting.length) { console.log(`round ${round}: ${drafting.length} draft(s)`); await draftRound(client, drafting, round); }
    const judging = jobs.filter((j) => j.state === "judge");
    if (judging.length) { console.log(`round ${round}: ${judging.length} to judge with ${judgeModel}`); await judgeRound(client, judging, round); }
  }
  for (const j of jobs.filter((x) => x.state === "ready")) {
    const jd = j.judgment;
    const review = jd ? { at: new Date().toISOString(), judgeVersion: jd.judgeVersion, naturalness: jd.naturalness, verdict: jd.verdict, reasons: jd.reasons, rewritten: j.rewritten, ...(jd.unverified ? { unverified: true } : {}) } : undefined;
    const put = await admin("/admin/translate/put", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang, slug: j.ref.tractate.slug, daf: j.ref.daf, ...j.draft, of: j.note.generatedAt, model, promptVersion: hashTranslatePrompt(lang), usage: { inputTokens: j.inputTokens, outputTokens: j.outputTokens, attempts: j.drafts, estUsd: usd(j) }, review }),
    });
    console.log(`${j.key}: ${put.status} ${put.body.status ?? ""} ${put.body.reason ?? ""} ${(put.body.problems ?? []).join(" | ")} (${j.drafts} draft/s${j.judged ? `, judged${j.rewritten ? ", rewritten" : ""}` : ""}, ${j.inputTokens} in / ${j.outputTokens} out ≈ $${usd(j).toFixed(3)} batch)`);
  }
  for (const j of jobs.filter((x) => x.state === "given-up")) console.log(`${j.key}: FAILED after ${j.drafts} draft(s): ${j.reason}`);
  totalUsd += jobs.reduce((n, j) => n + usd(j), 0);
}

async function main() {
  if (mode === "worker") return runWorker();
  return runBatch();
}
main().then(() => console.log(`estimated total ≈ $${totalUsd.toFixed(2)}`)).catch((e) => { console.error(e); process.exit(1); });
