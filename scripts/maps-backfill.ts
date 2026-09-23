/**
 * Draw the map of the page for the archive, offline through the Batch API (half price, hours not seconds), and store
 * each map through POST /admin/map/put once it has passed the gate.
 *
 *   npm run maps:backfill -- --rest | --all [--near 3] [--limit N] [--dapim slug/daf,…] [--window N] [--force] [--dry]
 *                            [--fetch-only] [--effort high|medium|low] [--model claude-opus-5] [--budget N]
 *                            [--retry-given-up]   try the given-up pages again (after a gate or prompt change)
 *
 * Targets: --window N (today ± N), --dapim, --rest (the rest of this cycle), --all; they add up. Dapim within --near days of today (default 3) are the
 * cron's and are skipped. A daf whose stored map is already the current style is skipped unless --force.
 * Rounds: a draft batch, the gate (src/map/gate.ts, the same one the Worker runs), one more draft with the gate's
 * feedback for the rejects; at most MAP_MAX_DRAFTS drafts per daf. A map that never passes is left undrawn and listed.
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
import { nearKeys, parseTargets } from "./lib/targets";
import { pageMapText, type MapPageText } from "./lib/text-cache";
import { runMessageBatch } from "./lib/batch";
import { canWrite, loadWriteLog, saveWriteLog } from "./lib/budget";
import { checkMap } from "../src/map/gate";
import { MAP_MAX_DRAFTS, mapRequest } from "../src/map/generate";
import { hashMapPrompt, MapSchema, type MapDraft } from "../src/map/prompt";
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

type Status = "stored" | "given-up" | "refused" | "rejected" | "budget" | "current";
interface Outcome { status: Status; at: string; reason?: string; drafts: number; estUsd: number; generatedAt?: string; units?: number; draft?: MapDraft; replaces?: string | null; usage?: { inputTokens: number; outputTokens: number } }
interface Job { key: string; ref: DafRef; text: MapPageText; replaces: string | null; feedback?: string; drafts: number; inputTokens: number; outputTokens: number; draft?: MapDraft; state: "draft" | "ready" | "given-up"; reason?: string }

const cid = (key: string) => key.replace("/", "-");
const usd = (inputTokens: number, outputTokens: number) => Math.round((estimateUsd(model, inputTokens, outputTokens) / 2) * 10000) / 10000; // batch price
const utcDay = () => new Date().toISOString().slice(0, 10);

async function main() {
  const targets = [...parseTargets(opt, flag)].filter(([k]) => !near.has(k));
  if (targets.length === 0) { console.error("no targets: use --rest, --all, --window N or --dapim slug/daf (near days are skipped)"); process.exit(2); }
  const outcomes: Record<string, Outcome> = existsSync(OUTCOMES) ? JSON.parse(readFileSync(OUTCOMES, "utf8")) : {};
  const save = () => writeFileSync(OUTCOMES, JSON.stringify(outcomes, null, 1));
  const retryGivenUp = flag("retry-given-up");
  const done = (k: string) => (retryGivenUp ? ["stored", "current"] : ["stored", "given-up", "current"]).includes(outcomes[k]?.status ?? "") && !(force && outcomes[k]?.status === "current");
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
    if (existing && existing.promptVersion === style && !force) { outcomes[key] = { status: "current", at: new Date().toISOString(), drafts: 0, estUsd: 0, generatedAt: existing.generatedAt }; return; }
    // A draft gated on an earlier run and waiting on the write budget goes straight to the put.
    const waiting = outcomes[key]?.status === "budget" ? outcomes[key] : undefined;
    jobs.push({ key, ref, text: texts.get(key)!, replaces: existing?.generatedAt ?? null, drafts: waiting?.drafts ?? 0, inputTokens: waiting?.usage?.inputTokens ?? 0, outputTokens: waiting?.usage?.outputTokens ?? 0, draft: waiting?.draft, state: waiting?.draft ? "ready" : "draft" });
  });
  save();
  console.log(`${jobs.length} to draw, ${todo.length - jobs.length} already current`);

  for (let round = 1; jobs.some((j) => j.state === "draft"); round++) {
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
      if (check.ok) { j.draft = r.parsed; j.state = "ready"; continue; }
      console.log(`${j.key}: draft ${j.drafts} failed the gate: ${check.problems.join(" | ")}`);
      if (j.drafts >= MAP_MAX_DRAFTS) { giveUp(j, `gate after ${j.drafts} drafts: ${check.problems.join(" | ")}`); continue; }
      j.feedback = check.problems.join(" ");
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
    const { status, body } = await adminJson(token, "/admin/map/put", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, daf: Number(daf), ...j.draft, model, promptVersion: style, usage: { inputTokens: j.inputTokens, outputTokens: j.outputTokens, attempts: j.drafts, estUsd: base.estUsd }, replaces: j.replaces }) });
    if (status === 200) { log.count++; saveWriteLog(log); outcomes[j.key] = { ...base, status: "stored", generatedAt: body.generatedAt }; console.log(`${j.key}: stored (${j.drafts} draft/s, ${j.draft!.units.length} units, ≈ $${base.estUsd.toFixed(3)})`); }
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
