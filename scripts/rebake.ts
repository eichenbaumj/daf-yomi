/**
 * The precision re-bake: rewrite only the notes the audit sent back, offline through the Batch API, and store each
 * through POST /admin/note/put once it has passed the gate and the judge.
 *
 *   npm run notes:rebake -- --audit data/audit/2026-09-22.json [--budget 850] [--limit N] [--dapim …] [--dry]
 *
 * Rounds: a draft batch (the writer sees its old note and the judge's feedback), the gate, a judge batch, and one
 * more draft with the judge's new feedback if it was sent back again; at most three drafts and two judge readings per
 * daf. A note that never satisfies both is left as it was and listed for hand review. Dapim within --near days of
 * today (default 3) are the cron's and are skipped. Writes stop at --budget KV writes for the UTC day (free plan:
 * 1,000, the cron needs ~35, translations and cards share it); the put endpoint's 429 is the backstop.
 * Outcomes go next to the audit file (<audit>.outcomes.json) and the run resumes from them. At the end the script
 * prints the --dapim lists for `npm run translate` (rebaked dapim that had a Hebrew note) and `npm run og:backfill`
 * (rebaked dapim that had a share card).
 * Needs ANTHROPIC_API_KEY (env) and ADMIN_TOKEN (env or .dev.vars).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { checkNote } from "../src/note/grounding";
import { JudgeSchema, hashJudgePrompt, judgeRequest, verifyJudgment, type Judgment } from "../src/note/judge";
import { NoteSchema, SYSTEM_PROMPT, hashPrompt, userMessage, type NoteDraft } from "../src/note/prompt";
import { estimateUsd } from "../src/note/generate";
import { adminJson, adminToken, flag, opt, site } from "./lib/cli";
import { nearKeys, refForKey } from "./lib/targets";
import { pageText, type PageText } from "./lib/text-cache";
import { runMessageBatch } from "./lib/batch";
import type { AuditEntry, AuditFile } from "./lib/audit";
import { canWrite, loadWriteLog, saveWriteLog } from "./lib/budget";

const auditPath = opt("audit");
if (!auditPath) { console.error("need --audit data/audit/<date>.json"); process.exit(2); }
const outcomesPath = auditPath.replace(/\.json$/, ".outcomes.json");
const model = opt("model") ?? "claude-opus-5";
const budget = Number(opt("budget") ?? 850);
const limit = Number(opt("limit") ?? Infinity);
const near = nearKeys(Number(opt("near") ?? 3));
const dry = flag("dry");
const only = new Set((opt("dapim") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const MAX_DRAFTS = 3, MAX_JUDGES = 2;

interface Outcome { status: "stored" | "given-up" | "refused" | "rejected" | "budget"; at: string; reason?: string; question?: string; generatedAt?: string; drafts: number; judges: number; estUsd: number; hadTranslation?: boolean; hadCard?: boolean }
interface Job { key: string; entry: AuditEntry; text: PageText; feedback: string; drafts: number; judges: number; draft?: NoteDraft; judgment?: Judgment; inputTokens: number; outputTokens: number; state: "draft" | "judge" | "ready" | "given-up"; reason?: string }

async function main() {
  const audit = JSON.parse(readFileSync(auditPath!, "utf8")) as AuditFile;
  if (audit.promptVersion !== hashPrompt()) console.log(`note: the audit was made under style ${audit.promptVersion}; notes will be written under ${hashPrompt()}`);
  const outcomes: Record<string, Outcome> = existsSync(outcomesPath) ? JSON.parse(readFileSync(outcomesPath, "utf8")) : {};
  const save = () => writeFileSync(outcomesPath, JSON.stringify(outcomes, null, 1));
  const todo = Object.values(audit.dapim)
    .filter((e) => e.rebake && !near.has(e.key) && (only.size === 0 || only.has(e.key)) && !["stored", "given-up"].includes(outcomes[e.key]?.status ?? ""))
    .slice(0, limit);
  console.log(`${todo.length} to re-bake (of ${Object.values(audit.dapim).filter((e) => e.rebake).length} sent back; near days and finished ones skipped)`);
  if (todo.length === 0) return finish(outcomes);
  if (dry) { for (const e of todo) console.log(`${e.key}: ${e.why.join(", ")}`); return; }
  if (!process.env.ANTHROPIC_API_KEY) { console.error("needs ANTHROPIC_API_KEY"); process.exit(2); }
  const token = adminToken();
  const client = new Anthropic({ maxRetries: 3 });

  const jobs: Job[] = [];
  for (const entry of todo) {
    const text = await pageText(refForKey(entry.key));
    const reasons = [entry.judge?.feedback ?? "", ...entry.gate].filter(Boolean).join(" ");
    jobs.push({ key: entry.key, entry, text, drafts: 0, judges: 0, inputTokens: 0, outputTokens: 0, state: "draft",
      feedback: `It read: "${entry.summary}" QUESTION: "${entry.question}" It was sent back because: ${reasons}` });
  }

  for (let round = 1; jobs.some((j) => j.state === "draft" || j.state === "judge"); round++) {
    // Drafts for everything that needs one.
    const drafting = jobs.filter((j) => j.state === "draft");
    if (drafting.length) {
      const results = await runMessageBatch(client, `rebake-draft-r${round}`, drafting.map((j) => ({ custom_id: j.key.replace("/", "-"), params: { model, max_tokens: 4000, system: SYSTEM_PROMPT, messages: [{ role: "user" as const, content: userMessage({ ...j.text.input, feedback: j.feedback }) }], output_config: { format: zodOutputFormat(NoteSchema) } } })), NoteSchema);
      for (const j of drafting) {
        const r = results.get(j.key.replace("/", "-"));
        j.drafts++;
        if (r) { j.inputTokens += r.usage.inputTokens; j.outputTokens += r.usage.outputTokens; }
        if (!r?.parsed) { giveUp(j, `draft ${j.drafts}: ${r?.error ?? "no result"}`); continue; }
        const check = checkNote(r.parsed, j.text.sourceText);
        if (check.ok) { j.draft = r.parsed; j.state = "judge"; continue; }
        console.log(`${j.key}: draft ${j.drafts} failed the gate: ${check.problems.join(" | ")}`);
        if (j.drafts >= MAX_DRAFTS) { giveUp(j, `gate after ${j.drafts} drafts: ${check.problems.join(" | ")}`); continue; }
        j.feedback = check.problems.join(" ");
      }
    }
    // The judge for every grounded draft.
    const judging = jobs.filter((j) => j.state === "judge" && j.draft);
    if (judging.length) {
      const results = await runMessageBatch(client, `rebake-judge-r${round}`, judging.map((j) => ({ custom_id: j.key.replace("/", "-"), params: judgeRequest(model, j.text.input, j.draft!) })), JudgeSchema);
      for (const j of judging) {
        const r = results.get(j.key.replace("/", "-"));
        j.judges++;
        if (r) { j.inputTokens += r.usage.inputTokens; j.outputTokens += r.usage.outputTokens; }
        if (!r?.parsed) { console.log(`${j.key}: judge gave no verdict (${r?.error ?? "no result"}); accepting the grounded draft`); j.state = "ready"; continue; }
        j.judgment = verifyJudgment(r.parsed, j.text.sourceText);
        if (j.judgment.verdict === "keep") { j.state = "ready"; continue; }
        console.log(`${j.key}: judge sent draft ${j.drafts} back (${j.judgment.reasons.join(", ")})`);
        if (j.judges >= MAX_JUDGES || j.drafts >= MAX_DRAFTS) { giveUp(j, `judge after ${j.drafts} drafts: ${j.judgment.reasons.join(", ")}`); continue; }
        j.feedback = `It read: "${j.draft!.summary}" QUESTION: "${j.draft!.question}" It was sent back because: ${j.judgment.feedback}`;
        j.state = "draft";
      }
    }
    for (const j of jobs) if (j.state === "given-up" && !outcomes[j.key]) { outcomes[j.key] = { status: "given-up", at: new Date().toISOString(), reason: j.reason, drafts: j.drafts, judges: j.judges, estUsd: usd(j) }; save(); }
  }

  // Store, under the day's KV write budget.
  const log = loadWriteLog();
  for (const j of jobs.filter((x) => x.state === "ready")) {
    if (!canWrite(log, budget)) { console.log(`KV write budget of ${budget} reached for today; ${jobs.filter((x) => x.state === "ready" && !outcomes[x.key]).length} left for tomorrow (rerun the same command)`); break; }
    const jd = j.judgment;
    const review = jd ? { at: new Date().toISOString(), judgeVersion: hashJudgePrompt(), questionStatus: jd.questionStatus, reach: jd.reach, verdict: jd.verdict, rewritten: false, ...(jd.unverified ? { unverified: true } : {}) } : undefined;
    const { status, body } = await adminJson(token, "/admin/note/put", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: j.key.split("/")[0], daf: Number(j.key.split("/")[1]), ...j.draft, model, promptVersion: hashPrompt(), usage: { inputTokens: j.inputTokens, outputTokens: j.outputTokens, attempts: j.drafts, estUsd: usd(j) }, review, replaces: j.entry.generatedAt }) });
    const base = { at: new Date().toISOString(), drafts: j.drafts, judges: j.judges, estUsd: usd(j), question: j.draft!.question, hadTranslation: j.entry.hadTranslation };
    if (status === 200) {
      log.count++; saveWriteLog(log);
      const og = await adminJson(token, `/admin/og/status?slug=${j.key.split("/")[0]}&daf=${j.key.split("/")[1]}`);
      outcomes[j.key] = { ...base, status: "stored", generatedAt: body.generatedAt, hadCard: Boolean(og.body?.card) };
      console.log(`${j.key}: stored (${j.drafts} draft/s, ${j.judges} judge/s, ≈ $${usd(j).toFixed(3)}) Q: ${j.draft!.question}`);
    } else if (status === 429 && body.kind === "kv-budget") { outcomes[j.key] = { ...base, status: "budget", reason: body.reason }; console.log(`${j.key}: KV budget exhausted on the site; stopping`); save(); break; }
    else if (status === 409) { outcomes[j.key] = { ...base, status: "refused", reason: body.reason }; console.log(`${j.key}: refused: ${body.reason}`); }
    else if (status === 422) { outcomes[j.key] = { ...base, status: "rejected", reason: (body.problems ?? []).join(" | ") }; console.log(`${j.key}: rejected by the site's gate: ${(body.problems ?? []).join(" | ")}`); }
    else { outcomes[j.key] = { ...base, status: "refused", reason: `HTTP ${status}` }; console.log(`${j.key}: HTTP ${status}`); }
    save();
  }
  finish(outcomes);
}

function giveUp(j: Job, reason: string) { j.state = "given-up"; j.reason = reason; console.log(`${j.key}: given up: ${reason}`); }
const usd = (j: Job) => Math.round((estimateUsd(model, j.inputTokens, j.outputTokens) / 2) * 10000) / 10000;

function finish(outcomes: Record<string, Outcome>) {
  const all = Object.entries(outcomes);
  const by = (s: Outcome["status"]) => all.filter(([, o]) => o.status === s).map(([k]) => k);
  console.log(`\nstored ${by("stored").length}, given up ${by("given-up").length}, refused ${by("refused").length}, rejected ${by("rejected").length}, waiting on budget ${by("budget").length}; ≈ $${all.reduce((n, [, o]) => n + o.estUsd, 0).toFixed(2)} so far`);
  const translate = all.filter(([, o]) => o.status === "stored" && o.hadTranslation).map(([k]) => k);
  const cards = all.filter(([, o]) => o.status === "stored" && o.hadCard).map(([k]) => k);
  if (translate.length) console.log(`\nnpm run translate -- --site ${site} --lang he --force --dapim ${translate.join(",")}`);
  if (cards.length) console.log(`\nnpm run og:backfill -- --site ${site} --dapim ${cards.join(",")}`);
  const givenUp = by("given-up");
  if (givenUp.length) console.log(`\nfor hand review (left as they were): ${givenUp.join(", ")}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
