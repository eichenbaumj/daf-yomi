/**
 * Draw the map of the page for the archive, offline through the Batch API (half price, hours not seconds), and store
 * each map through POST /admin/map/put once it has passed the gate.
 *
 *   npm run maps:backfill -- --rest | --all [--near 3] [--limit N] [--dapim slug/daf,…] [--window N] [--force] [--dry]
 *                            [--fetch-only] [--effort high|medium|low] [--model claude-opus-5] [--budget N]
 *                            [--retry-given-up]   try the given-up pages again (after a gate or prompt change)
 *                            [--no-judge]         skip the judge round
 *                            [--redraw-from data/audit/maps-<date>.json]   redraw the maps an audit sent back, once, with its feedback
 *
 * Rounds: a draft batch, the gate, a judge batch (src/map/judge.ts) for the drafts that passed, one more draft with
 * the judge's feedback for the ones it sent back (never judged again); a redraw that fails the gate stores the judged
 * draft with the verdict on it. At most MAP_MAX_DRAFTS drafts and one judge reading per page.
 *
 * Targets: --window N (today ± N), --dapim, --rest (the rest of this cycle), --all; they add up. Dapim within --near days of today (default 3) are the
 * cron's and are skipped. A daf whose stored map is already the current style is skipped unless --force.
 * The gate is src/map/gate.ts, the one the Worker runs. A map that never passes is left undrawn and listed.
 * The page text comes from Sefaria once into .cache/map-text/ (paced; --fetch-only fills it and stops, ~70 minutes for
 * the whole cycle). Outcomes in .cache/maps-backfill.outcomes.json; a rerun resumes from them and from the batch ids
 * in .cache/batches/. Writes stop at --budget KV writes for the UTC day (Workers Paid: no ceiling; the default is
 * generous) and on the put endpoint's 429.
 * --effort sets output_config.effort on the drafts (Opus 5 thinks before it answers and the thinking is most of the
 * output tokens; medium is the cheaper knob to try on the archive). Needs ANTHROPIC_API_KEY and ADMIN_TOKEN.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { adminJson, adminToken, anthropicClientOptions, flag, opt, pool, site } from "./lib/cli";
import { nearKeys, parseTargets, refForKey } from "./lib/targets";
import { pageMapText, type MapPageText } from "./lib/text-cache";
import { runMessageBatch } from "./lib/batch";
import { canWrite, loadWriteLog, saveWriteLog } from "./lib/budget";
import { checkMap } from "../src/map/gate";
import { MAP_MAX_DRAFTS, mapRequest } from "../src/map/generate";
import { hashMapPrompt, MapSchema, type MapDraft } from "../src/map/prompt";
import { hashMapJudgePrompt, MapJudgeSchema, mapJudgeRequest, verifyMapJudgment, type MapJudgment } from "../src/map/judge";
import type { DafMap } from "../src/map/store";
import { estimateUsd } from "../src/note/generate";
import type { DafRef } from "../src/daf/schedule";

const OUTCOMES = ".cache/maps-backfill.outcomes.json";
const model = opt("model") ?? "claude-opus-5";
const effort = opt("effort") as "high" | "medium" | "low" | undefined;
const budget = Number(opt("budget") ?? 100000);
const limit = Number(opt("limit") ?? Infinity);
const near = nearKeys(Number(opt("near") ?? 3));
const dry = flag("dry");
const force = flag("force");
const fetchOnly = flag("fetch-only");
const withJudge = !flag("no-judge");
const redrawFrom = opt("redraw-from");

type Status = "stored" | "given-up" | "refused" | "rejected" | "budget" | "current";
interface Outcome { status: Status; at: string; reason?: string; drafts: number; estUsd: number; generatedAt?: string; units?: number; draft?: MapDraft; replaces?: string | null; usage?: { inputTokens: number; outputTokens: number } }
interface Job { key: string; ref: DafRef; text: MapPageText; replaces: string | null; feedback?: string; drafts: number; inputTokens: number; outputTokens: number; draft?: MapDraft; judged?: MapDraft; judgment?: MapJudgment; rewritten: boolean; state: "draft" | "judge" | "ready" | "given-up"; reason?: string }
type Review = NonNullable<DafMap["review"]>;
const reviewOf = (j: Job): Review | undefined => (j.judgment ? { at: new Date().toISOString(), judgeVersion: hashMapJudgePrompt(), verdict: j.judgment.verdict, reasons: j.judgment.reasons, rewritten: j.rewritten, ...(j.judgment.unverified ? { unverified: true } : {}) } : undefined);

const cid = (key: string) => key.replace("/", "-");
const usd = (inputTokens: number, outputTokens: number) => Math.round((estimateUsd(model, inputTokens, outputTokens) / 2) * 10000) / 10000; // batch price
const utcDay = () => new Date().toISOString().slice(0, 10);

async function main() {
  // With --redraw-from, the targets are the maps an audit sent back, each with the judge's feedback; they are drawn
  // once more (no second judge) and stored over the map the audit read.
  const redraws = new Map<string, string>();
  if (redrawFrom) {
    const audit = JSON.parse(readFileSync(redrawFrom, "utf8")) as { dapim: Record<string, { judge?: { verdict: string; feedback: string } }> };
    for (const [k, e] of Object.entries(audit.dapim)) if (e.judge?.verdict === "redraw" && e.judge.feedback) redraws.set(k, e.judge.feedback);
  }
  const targets = redrawFrom ? [...redraws.keys()].map((k) => [k, refForKey(k)] as const) : [...parseTargets(opt, flag)].filter(([k]) => !near.has(k));
  if (targets.length === 0) { console.error("no targets: use --rest, --all, --window N, --dapim slug/daf or --redraw-from (near days are skipped)"); process.exit(2); }
  const outcomes: Record<string, Outcome> = existsSync(OUTCOMES) ? JSON.parse(readFileSync(OUTCOMES, "utf8")) : {};
  const save = () => writeFileSync(OUTCOMES, JSON.stringify(outcomes, null, 1));
  const retryGivenUp = flag("retry-given-up");
  const done = (k: string) => !redrawFrom && (retryGivenUp ? ["stored", "current"] : ["stored", "given-up", "current"]).includes(outcomes[k]?.status ?? "") && !(force && outcomes[k]?.status === "current");
  const todo = targets.filter(([k]) => !done(k)).slice(0, limit);
  console.log(`${todo.length} to draw (of ${targets.length} targets; near days and finished ones skipped)${effort ? `, effort ${effort}` : ""}${dry ? ", dry run" : ""}`);
  if (todo.length === 0) return finish(outcomes);
  if (dry) { console.log(todo.map(([k]) => k).join(" ")); return; }

  // The page text, once into the cache; then, unless --fetch-only, what the site already has.
  const texts = new Map<string, MapPageText>();
  for (const [key, ref] of todo) {
    texts.set(key, await pageMapText(ref));
    if (texts.size % 100 === 0) console.log(`  ${texts.size} pages cached`);
  }
  if (fetchOnly) { console.log(`${texts.size} pages in .cache/map-text/`); return; }
  if (!process.env.ANTHROPIC_API_KEY) { console.error("needs ANTHROPIC_API_KEY"); process.exit(2); }
  const token = adminToken();
  const client = new Anthropic(anthropicClientOptions());

  const jobs: Job[] = [];
  const style = hashMapPrompt();
  await pool(todo, 6, async ([key, ref]) => {
    const [slug, daf] = key.split("/");
    const { status, body } = await adminJson(token, `/admin/map?slug=${slug}&daf=${daf}`);
    const existing = status === 200 ? (body.map as DafMap | null) : null;
    if (redrawFrom) {
      // The judge's verdict travels with the redraw; the audit read the stored map, so `replaces` is its generatedAt.
      if (!existing) return;
      jobs.push({ key, ref, text: texts.get(key)!, replaces: existing.generatedAt, feedback: `The map read: ${existing.units.map((u, i) => `${i + 1}. [${u.from}..${u.to}] ${u.kind}: ${u.title}.`).join(" ")} It was sent back because: ${redraws.get(key)}`, drafts: 0, inputTokens: 0, outputTokens: 0, rewritten: true, judgment: undefined, judged: undefined, state: "draft" });
      return;
    }
    if (existing && existing.promptVersion === style && !force) { outcomes[key] = { status: "current", at: new Date().toISOString(), drafts: 0, estUsd: 0, generatedAt: existing.generatedAt }; return; }
    // A draft gated on an earlier run and waiting on the write budget goes straight to the put.
    const waiting = outcomes[key]?.status === "budget" ? outcomes[key] : undefined;
    jobs.push({ key, ref, text: texts.get(key)!, replaces: existing?.generatedAt ?? null, drafts: waiting?.drafts ?? 0, inputTokens: waiting?.usage?.inputTokens ?? 0, outputTokens: waiting?.usage?.outputTokens ?? 0, draft: waiting?.draft, rewritten: false, state: waiting?.draft ? "ready" : "draft" });
  });
  save();
  console.log(`${jobs.length} to draw, ${todo.length - jobs.length} already current`);

  for (let round = 1; jobs.some((j) => j.state === "draft" || j.state === "judge"); round++) {
    const drafting = jobs.filter((j) => j.state === "draft");
    const requests = drafting.map((j) => {
      const req = mapRequest(model, { ...j.text.input, feedback: j.feedback });
      return { custom_id: cid(j.key), params: effort ? { ...req, output_config: { ...req.output_config, effort } } : req };
    });
    const results = await runMessageBatch(client, `map-draft-${utcDay()}-r${round}`, requests, MapSchema);
    for (const j of drafting) {
      const r = results.get(cid(j.key));
      j.drafts++;
      if (r) { j.inputTokens += r.usage.inputTokens; j.outputTokens += r.usage.outputTokens; }
      if (!r?.parsed) { if (j.drafts >= MAP_MAX_DRAFTS) giveUp(j, `draft ${j.drafts}: ${r?.error ?? "no result"}`); else j.feedback = "Return only the structured fields, complete."; continue; }
      const check = checkMap(r.parsed, j.text.input, j.text.sourceText);
      if (check.ok) { j.draft = r.parsed; j.state = withJudge && !j.judgment && !redrawFrom ? "judge" : "ready"; continue; }
      console.log(`${j.key}: draft ${j.drafts} failed the gate: ${check.problems.join(" | ")}`);
      // A redraw the judge asked for that fails the gate: the judged draft is stored, with the verdict on it.
      if (j.judged && (j.drafts >= MAP_MAX_DRAFTS)) { j.draft = j.judged; j.rewritten = false; j.state = "ready"; console.log(`${j.key}: keeping the judged draft`); continue; }
      if (j.drafts >= MAP_MAX_DRAFTS) { giveUp(j, `gate after ${j.drafts} drafts: ${check.problems.join(" | ")}`); continue; }
      j.feedback = check.problems.join(" ");
    }
    // The judge for every draft that passed the gate and has not been read yet; a redraw verdict buys one more draft.
    const judging = jobs.filter((j) => j.state === "judge" && j.draft);
    if (judging.length) {
      const results = await runMessageBatch(client, `map-judge-${utcDay()}-r${round}`, judging.map((j) => ({ custom_id: cid(j.key), params: mapJudgeRequest(model, { label: j.text.input.label, positionLine: j.text.input.positionLine, sections: j.text.input.sections }, j.draft!) })), MapJudgeSchema);
      for (const j of judging) {
        const r = results.get(cid(j.key));
        if (r) { j.inputTokens += r.usage.inputTokens; j.outputTokens += r.usage.outputTokens; }
        if (!r?.parsed) { console.log(`${j.key}: judge gave no verdict (${r?.error ?? "no result"}); keeping the draft`); j.state = "ready"; continue; }
        j.judgment = verifyMapJudgment(r.parsed, j.draft!, j.text.input.sections, j.text.sourceText);
        if (j.judgment.verdict === "keep" || j.drafts >= MAP_MAX_DRAFTS) { j.state = "ready"; continue; }
        console.log(`${j.key}: judge sent draft ${j.drafts} back (${j.judgment.reasons.join(", ")})`);
        j.judged = j.draft; j.draft = undefined; j.rewritten = true; j.feedback = j.judgment.feedback; j.state = "draft";
      }
    }
    for (const j of jobs) if (j.state === "given-up" && outcomes[j.key]?.status !== "given-up") { outcomes[j.key] = { status: "given-up", at: new Date().toISOString(), reason: j.reason, drafts: j.drafts, estUsd: usd(j.inputTokens, j.outputTokens) }; }
    save();
  }

  // Store, under the day's KV write budget.
  const log = loadWriteLog();
  for (const j of jobs.filter((x) => x.state === "ready" && x.draft)) {
    const base = { at: new Date().toISOString(), drafts: j.drafts, estUsd: usd(j.inputTokens, j.outputTokens), units: j.draft!.units.length };
    if (!canWrite(log, budget)) { outcomes[j.key] = { ...base, status: "budget", draft: j.draft, replaces: j.replaces, usage: { inputTokens: j.inputTokens, outputTokens: j.outputTokens } }; continue; }
    const [slug, daf] = j.key.split("/");
    const { status, body } = await adminJson(token, "/admin/map/put", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, daf: Number(daf), ...j.draft, model, promptVersion: style, usage: { inputTokens: j.inputTokens, outputTokens: j.outputTokens, attempts: j.drafts, estUsd: base.estUsd }, review: reviewOf(j), replaces: j.replaces }) });
    if (status === 200) { log.count++; saveWriteLog(log); outcomes[j.key] = { ...base, status: "stored", generatedAt: body.generatedAt }; console.log(`${j.key}: stored (${j.drafts} draft/s${j.judgment ? `, judge ${j.judgment.verdict}${j.rewritten ? ", rewritten" : ""}` : ""}, ${j.draft!.units.length} units, ≈ $${base.estUsd.toFixed(3)})`); }
    else if (status === 429 && body.kind === "kv-budget") { outcomes[j.key] = { ...base, status: "budget", reason: body.reason, draft: j.draft, replaces: j.replaces, usage: { inputTokens: j.inputTokens, outputTokens: j.outputTokens } }; console.log(`${j.key}: KV budget exhausted on the site; stopping`); save(); break; }
    else if (status === 409) { outcomes[j.key] = { ...base, status: "refused", reason: body.reason }; console.log(`${j.key}: refused: ${body.reason}`); }
    else if (status === 422) { outcomes[j.key] = { ...base, status: "rejected", reason: (body.problems ?? []).join(" | ") }; console.log(`${j.key}: rejected by the site's gate: ${(body.problems ?? []).join(" | ")}`); }
    else { outcomes[j.key] = { ...base, status: "refused", reason: `HTTP ${status}` }; console.log(`${j.key}: HTTP ${status}`); }
    save();
  }
  finish(outcomes);
}

function giveUp(j: Job, reason: string) { j.state = "given-up"; j.reason = reason; console.log(`${j.key}: given up: ${reason}`); }

function finish(outcomes: Record<string, Outcome>) {
  const all = Object.entries(outcomes);
  const by = (s: Status) => all.filter(([, o]) => o.status === s).map(([k]) => k);
  console.log(`\nstored ${by("stored").length}, current ${by("current").length}, given up ${by("given-up").length}, refused ${by("refused").length}, rejected ${by("rejected").length}, waiting on budget ${by("budget").length}; ≈ $${all.reduce((n, [, o]) => n + o.estUsd, 0).toFixed(2)} so far (batch price)`);
  const givenUp = by("given-up");
  if (givenUp.length) console.log(`\nleft undrawn, for hand review: ${givenUp.join(", ")}`);
  console.log(`site ${site}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
