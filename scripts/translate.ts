/**
 * Translate stored English notes into another language.
 *
 *   npm run translate -- --site https://daf-yomi.dev --lang he --window 7 [--dapim berakhot/2,shabbat/31] [--all]
 *                        [--mode batch|worker] [--force] [--dry]
 *
 * Targets: --window N (today ± N days), --dapim slug/daf[,…], --all (every daf of the cycle). They add up.
 * Modes:
 *   worker  POST /admin/translate per daf: the Worker calls Claude, checks and stores. Simple; fine for a window.
 *   batch   (default) Reads each English note from GET /admin/note and the aligned text from Sefaria, sends every
 *           request in one Message Batch (half price, hours not seconds), checks each result locally with the same
 *           checkTranslation the Worker runs, POSTs the good ones to /admin/translate/put (which checks again and
 *           refuses stale ones), and sends the rejects back in a second batch with the checker's feedback.
 * Needs ADMIN_TOKEN (env or .dev.vars) for the site and ANTHROPIC_API_KEY (env) for batch mode.
 * KV note: each stored translation is one KV write (free plan: 1,000 a day).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClientOptions } from "./lib/cli";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TRACTATES, tractateBySlug, type Tractate } from "../src/daf/tractates";
import { addDays, dafForDate, dateForDaf, todayIn, ymd, type DafRef } from "../src/daf/schedule";
import { buildTranslateInput, checkTranslation, hashTranslatePrompt, systemPrompt, translateUserMessage, TranslationSchema, type TranslatableLang, type TranslateInput } from "../src/note/translate";
import { estimateUsd } from "../src/note/generate";
import type { DafNote } from "../src/note/store";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (k: string) => args.includes(`--${k}`);
const site = (opt("site") ?? "https://daf-yomi.dev").replace(/\/$/, "");
const lang = (opt("lang") ?? "he") as TranslatableLang;
const mode = opt("mode") ?? "batch";
const model = opt("model") ?? "claude-opus-5";
const force = flag("force");
const dry = flag("dry");
function tokenFromDevVars(): string | undefined {
  try { return /^ADMIN_TOKEN=(.+)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1]?.trim(); } catch { return undefined; }
}
const token = process.env.ADMIN_TOKEN ?? tokenFromDevVars();
if (!token) { console.error("need ADMIN_TOKEN (env or .dev.vars)"); process.exit(2); }
if (lang !== "he") { console.error("only --lang he has a style guide today"); process.exit(2); }

// ---- targets ----
const today = todayIn("UTC");
const cycle = dafForDate(today).cycle;
const targets = new Map<string, DafRef>();
const add = (ref: DafRef) => targets.set(`${ref.tractate.slug}/${ref.daf}`, ref);
const refFor = (t: Tractate, daf: number): DafRef => dafForDate(dateForDaf(t, daf, cycle));
const window = Number(opt("window") ?? NaN);
if (Number.isFinite(window)) for (let d = -window; d <= window; d++) add(dafForDate(addDays(today, d)));
for (const x of (opt("dapim") ?? "").split(",").filter(Boolean)) {
  const [slug, n] = x.split("/");
  const t = tractateBySlug(slug ?? "");
  if (!t) { console.error(`unknown tractate ${slug}`); process.exit(2); }
  add(refFor(t, Number(n)));
}
if (flag("all")) for (const t of TRACTATES) for (let d = t.firstDaf; d <= t.lastDaf; d++) add(refFor(t, d));
if (targets.size === 0) { console.error("no targets: use --window N, --dapim slug/daf, or --all"); process.exit(2); }
console.log(`${targets.size} target(s), lang ${lang}, mode ${mode}, site ${site}${force ? ", force" : ""}${dry ? ", dry run" : ""}`);

const auth = { authorization: `Bearer ${token}` };
let totalUsd = 0;

async function adminJson(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${site}${path}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// ---- worker mode: the Worker does everything, one call per daf ----
async function runWorker() {
  for (const [key, ref] of targets) {
    if (dry) { console.log(`${key}: would POST /admin/translate`); continue; }
    const { status, body } = await adminJson(`/admin/translate?slug=${ref.tractate.slug}&daf=${ref.daf}&lang=${lang}${force ? "&force=1" : ""}`, { method: "POST" });
    const u = body.translation?.usage;
    if (u) totalUsd += u.estUsd;
    console.log(`${key}: ${status} ${body.status ?? ""} ${body.reason ?? ""}${body.attempts ? ` (${body.attempts} attempt/s)` : ""}${u ? ` ${u.inputTokens} in / ${u.outputTokens} out ≈ $${u.estUsd.toFixed(3)}` : ""}`);
    for (const p of [...(body.firstAttemptProblems ?? []), ...(body.problems ?? [])]) console.log(`    ↳ ${p}`);
    if (body.lastDraft) console.log(`    rejected draft: ${body.lastDraft.summary}\n    Q: ${body.lastDraft.question}`);
  }
}

// ---- batch mode ----
interface Job { key: string; ref: DafRef; note: DafNote; input: TranslateInput; heSource: string; feedback?: string; attempts: number; inputTokens: number; outputTokens: number }

async function collectJobs(): Promise<Job[]> {
  const jobs: Job[] = [];
  const version = hashTranslatePrompt(lang);
  for (const [key, ref] of targets) {
    const { status, body } = await adminJson(`/admin/note?slug=${ref.tractate.slug}&daf=${ref.daf}&lang=${lang}`);
    if (status !== 200 || !body.note) { console.log(`${key}: no English note (${status}); skipped`); continue; }
    const note = body.note as DafNote;
    if (!force && body.translation && body.translation.of === note.generatedAt && body.translation.promptVersion === version) { console.log(`${key}: translation is current; skipped`); continue; }
    const { input, heSource } = await buildTranslateInput(ref, lang, note);
    jobs.push({ key, ref, note, input, heSource, attempts: 0, inputTokens: 0, outputTokens: 0 });
  }
  return jobs;
}

async function runBatch(client: Anthropic, jobs: Job[], round: number): Promise<Job[]> {
  if (jobs.length === 0) return [];
  const requests = jobs.map((j) => ({
    custom_id: j.key.replace("/", "-"),
    params: {
      model,
      max_tokens: 4000,
      system: systemPrompt(lang),
      messages: [{ role: "user" as const, content: translateUserMessage({ ...j.input, feedback: j.feedback }) }],
      output_config: { format: zodOutputFormat(TranslationSchema) },
    },
  }));
  const batch = await client.messages.batches.create({ requests });
  console.log(`round ${round}: batch ${batch.id} with ${requests.length} request(s) submitted; polling`);
  mkdirSync(".translate", { recursive: true });
  writeFileSync(`.translate/${batch.id}.json`, JSON.stringify({ lang, round, keys: jobs.map((j) => j.key) }, null, 2));
  let status = batch;
  while (status.processing_status !== "ended") {
    await new Promise((r) => setTimeout(r, 30_000));
    status = await client.messages.batches.retrieve(batch.id);
    process.stdout.write(`  ${new Date().toISOString().slice(11, 19)} processing ${status.request_counts.processing}, done ${status.request_counts.succeeded}, errored ${status.request_counts.errored}\n`);
  }
  const byId = new Map(jobs.map((j) => [j.key.replace("/", "-"), j]));
  const rejects: Job[] = [];
  for await (const result of await client.messages.batches.results(batch.id)) {
    const job = byId.get(result.custom_id);
    if (!job) continue;
    job.attempts++;
    if (result.result.type !== "succeeded") { console.log(`${job.key}: ${result.result.type}${result.result.type === "errored" ? ` ${JSON.stringify(result.result.error)}` : ""}`); rejects.push({ ...job, feedback: undefined }); continue; }
    const msg = result.result.message;
    job.inputTokens += msg.usage.input_tokens; job.outputTokens += msg.usage.output_tokens;
    if (msg.stop_reason === "refusal") { console.log(`${job.key}: refused`); continue; }
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    let draft;
    try { draft = TranslationSchema.parse(JSON.parse(text)); } catch (e) { console.log(`${job.key}: unparseable output`); rejects.push({ ...job, feedback: "Return only the structured fields." }); continue; }
    const check = checkTranslation(draft, job.heSource, job.note);
    if (!check.ok) {
      console.log(`${job.key}: rejected: ${check.problems.join(" | ")}\n    draft: ${draft.summary}\n    Q: ${draft.question}`);
      rejects.push({ ...job, feedback: check.problems.join(" ") });
      continue;
    }
    const estUsd = estimateUsd(model, job.inputTokens, job.outputTokens) / 2; // batch price
    totalUsd += estUsd;
    const put = await adminJson("/admin/translate/put", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang, slug: job.ref.tractate.slug, daf: job.ref.daf, ...draft, of: job.note.generatedAt, model, promptVersion: hashTranslatePrompt(lang), usage: { inputTokens: job.inputTokens, outputTokens: job.outputTokens, attempts: job.attempts, estUsd } }),
    });
    console.log(`${job.key}: ${put.status} ${put.body.status ?? ""} ${put.body.reason ?? ""} ${(put.body.problems ?? []).join(" | ")} (${job.attempts} attempt/s, ${job.inputTokens} in / ${job.outputTokens} out ≈ $${estUsd.toFixed(3)} batch)`);
  }
  return rejects;
}

async function main() {
  if (mode === "worker") return runWorker();
  if (!process.env.ANTHROPIC_API_KEY) { console.error("batch mode needs ANTHROPIC_API_KEY"); process.exit(2); }
  const client = new Anthropic(anthropicClientOptions());
  const jobs = await collectJobs();
  console.log(`${jobs.length} to translate`);
  if (dry) { for (const j of jobs) console.log(`--- ${j.key}\n${translateUserMessage(j.input).slice(0, 1500)}\n…`); return; }
  const rejects = await runBatch(client, jobs, 1);
  if (rejects.length) {
    console.log(`${rejects.length} to retry with feedback`);
    const failed = await runBatch(client, rejects, 2);
    for (const j of failed) console.log(`${j.key}: FAILED after ${j.attempts} attempt(s)`);
  }
}
main().then(() => console.log(`estimated total ≈ $${totalUsd.toFixed(2)}`)).catch((e) => { console.error(e); process.exit(1); });
