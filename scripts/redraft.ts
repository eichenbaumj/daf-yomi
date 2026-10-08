/**
 * A hand redraft of one stored note, for when a reader (usually Joe) finds a note confusing or wrong that the audit
 * kept. Works on any daf, today's included: the cron never overwrites a stored note, and nothing here sends email
 * (a reader whose issue has not gone out yet gets whatever note is stored when their hour comes).
 *
 *   npm run notes:redraft -- bekhorot/20 --why "the end of the question is confusing" [--n 3]
 *       Drafts N candidates (the writer sees the stored note and the reason), runs the gate and the judge on each (up
 *       to three drafts and two judge readings per candidate, the re-bake's bound), prints them, and writes
 *       data/redrafts/<date>-<slug>-<daf>.json with the note they would replace. Nothing is stored on the site.
 *   npm run notes:redraft -- bekhorot/20 --put 2
 *       Stores candidate 2 of the newest record through POST /admin/note/put (refused if the note changed since),
 *       re-translates the Hebrew note and redraws the share card when the old note had them, and prints what to check.
 *   npm run notes:redraft -- bekhorot/20 --restore
 *       Puts back the note the newest record replaced (the same words, a new generatedAt), with its Hebrew and card.
 *
 * Needs ANTHROPIC_API_KEY and ADMIN_TOKEN (env or .dev.vars). About $0.15 a candidate at list price (measured 2026-10-08).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { buildPromptInput, draftNote, estimateUsd } from "../src/note/generate";
import { checkNote } from "../src/note/grounding";
import { hashJudgePrompt, judgeNote, type Judgment } from "../src/note/judge";
import { hashPrompt, type NoteDraft, type PromptInput } from "../src/note/prompt";
import type { DafNote } from "../src/note/store";
import { adminJson, adminToken, anthropicClientOptions, args, flag, opt, site } from "./lib/cli";
import { refForKey } from "./lib/targets";

const key = args.find((a, i) => /^[a-z-]+\/\d+$/.test(a) && !(i > 0 && args[i - 1]!.startsWith("--")));
if (!key) { console.error("give the daf as slug/daf, e.g. bekhorot/20"); process.exit(2); }
const [slug, dafStr] = key.split("/") as [string, string];
const model = opt("model") ?? "claude-opus-5";
const MAX_DRAFTS = 3, MAX_JUDGES = 2;
const DIR = "data/redrafts";

interface Candidate {
  n: number; summary: string; question: string; quotes: string[];
  gate: "passed" | string[]; judge: { verdict: Judgment["verdict"]; questionStatus: Judgment["questionStatus"]; reach: Judgment["reach"]; reasons: string[]; feedback: string; unverified: boolean } | null;
  drafts: number; judges: number; inputTokens: number; outputTokens: number; estUsd: number;
}
interface RedraftRecord {
  daf: string; at: string; why: string; model: string; promptVersion: string; judgeVersion: string;
  replaces: DafNote; hadTranslation: boolean; hadCard: boolean;
  candidates: Candidate[];
  put?: { candidate: number; at: string; generatedAt: string; translation?: string; card?: string };
  restored?: { at: string; generatedAt: string };
}

const token = adminToken();
const admin = (path: string, init: RequestInit = {}) => adminJson(token, path, init);

async function main() {
  if (flag("put")) return put(Number(opt("put")));
  if (flag("restore")) return restore();
  return draft();
}

// ---- draft: N candidates, each through the gate and the judge ----
async function draft() {
  const why = opt("why");
  if (!why) { console.error('say what is wrong with the stored note: --why "…"'); process.exit(2); }
  const n = Math.max(1, Math.min(6, Number(opt("n") ?? 3)));
  const { status, body } = await admin(`/admin/note?slug=${slug}&daf=${dafStr}&lang=he`);
  if (status !== 200 || !body.note) { console.error(`no stored note for ${key} (HTTP ${status})`); process.exit(1); }
  const stored = body.note as DafNote;
  if (stored.promptVersion !== hashPrompt()) console.log(`note: the stored note was written under style ${stored.promptVersion}; candidates are written under ${hashPrompt()}`);
  const og = await admin(`/admin/og/status?slug=${slug}&daf=${dafStr}`);
  const { input, sourceText } = await buildPromptInput(refForKey(key!));
  const client = new Anthropic(anthropicClientOptions());
  const reason = `It read: "${stored.summary}" QUESTION: "${stored.question}" A reader sent it back because: ${why}`;
  console.log(`${key}: ${n} candidate(s) under style ${hashPrompt()}, model ${model}\n\nstored: ${stored.question}\nwhy: ${why}\n`);

  const candidates = await Promise.all(Array.from({ length: n }, (_, i) => candidate(client, i + 1, input, sourceText, reason)));
  const record: RedraftRecord = {
    daf: key!, at: new Date().toISOString(), why, model, promptVersion: hashPrompt(), judgeVersion: hashJudgePrompt(),
    replaces: stored, hadTranslation: Boolean(body.translation), hadCard: Boolean(og.body?.card), candidates,
  };
  mkdirSync(DIR, { recursive: true });
  const path = `${DIR}/${record.at.slice(0, 10)}-${slug}-${dafStr}.json`;
  writeFileSync(path, JSON.stringify(record, null, 1) + "\n");

  for (const c of candidates) {
    const verdict = c.gate !== "passed" ? `✗ gate: ${c.gate.join(" | ")}` : c.judge ? `judge: ${c.judge.verdict} (${c.judge.questionStatus}, ${c.judge.reach}${c.judge.reasons.length ? `; ${c.judge.reasons.join(", ")}` : ""})` : "judge gave no verdict";
    console.log(`━━━ ${c.n} · ${verdict} · ${c.drafts} draft/s · ≈ $${c.estUsd.toFixed(3)}\n\n${c.summary}\n\n${c.question}\n${c.quotes.length ? `\nquotes: ${c.quotes.map((q) => `"${q}"`).join(" · ")}\n` : ""}`);
  }
  console.log(`≈ $${candidates.reduce((s, c) => s + c.estUsd, 0).toFixed(2)} · saved ${path}\nstore one: npm run notes:redraft -- ${key} --put <n>`);
}

async function candidate(client: Anthropic, n: number, input: PromptInput, sourceText: string, reason: string): Promise<Candidate> {
  let feedback = reason, drafts = 0, judges = 0, inputTokens = 0, outputTokens = 0;
  let last: NoteDraft | null = null, gate: Candidate["gate"] = ["no draft"], judged: Judgment | null = null;
  while (drafts < MAX_DRAFTS) {
    const r = await draftNote(client, model, { ...input, feedback });
    drafts++; inputTokens += r.usage.inputTokens; outputTokens += r.usage.outputTokens;
    if (!r.draft) { gate = [r.refusal ? `refused: ${r.refusal}` : "unparseable"]; continue; }
    last = r.draft;
    const check = checkNote(r.draft, sourceText);
    if (!check.ok) { gate = check.problems; judged = null; feedback = `${reason} Your last draft also failed the house rules: ${check.problems.join(" ")}`; continue; }
    gate = "passed";
    if (judges >= MAX_JUDGES) break;
    const j = await judgeNote(client, model, input, r.draft, sourceText);
    judges++; inputTokens += j.usage.inputTokens; outputTokens += j.usage.outputTokens;
    judged = j.judgment;
    if (!judged || judged.verdict === "keep") break;
    feedback = `${reason} Your last draft read: "${r.draft.summary}" QUESTION: "${r.draft.question}" A second reader sent it back because: ${judged.feedback}`;
  }
  return {
    n, summary: last?.summary ?? "", question: last?.question ?? "", quotes: last?.quotes ?? [], gate,
    judge: judged ? { verdict: judged.verdict, questionStatus: judged.questionStatus, reach: judged.reach, reasons: judged.reasons, feedback: judged.feedback, unverified: judged.unverified } : null,
    drafts, judges, inputTokens, outputTokens, estUsd: estimateUsd(model, inputTokens, outputTokens),
  };
}

// ---- put / restore: store through the site's own gate, then the Hebrew note and the card ----
function newestRecord(): { path: string; record: RedraftRecord } {
  const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(`-${slug}-${dafStr}.json`)).sort() : [];
  if (!files.length) { console.error(`no redraft record for ${key} in ${DIR}; draft first`); process.exit(1); }
  const path = `${DIR}/${files.at(-1)}`;
  return { path, record: JSON.parse(readFileSync(path, "utf8")) as RedraftRecord };
}

async function put(n: number) {
  const { path, record } = newestRecord();
  const c = record.candidates.find((x) => x.n === n);
  if (!c) { console.error(`no candidate ${n} in ${path}`); process.exit(2); }
  if (c.gate !== "passed") { console.error(`candidate ${n} failed the gate; it cannot be stored`); process.exit(2); }
  if (c.judge?.verdict === "rebake" && !flag("over-judge")) { console.error(`the judge sent candidate ${n} back (${c.judge.reasons.join(", ")}); pass --over-judge to store it anyway`); process.exit(2); }
  if (record.promptVersion !== hashPrompt()) { console.error(`the house style changed since ${path} was drafted; draft again`); process.exit(2); }
  const review = c.judge ? { at: record.at, judgeVersion: record.judgeVersion, questionStatus: c.judge.questionStatus, reach: c.judge.reach, verdict: c.judge.verdict, rewritten: false, ...(c.judge.unverified ? { unverified: true } : {}) } : undefined;
  const generatedAt = await store({ summary: c.summary, question: c.question, quotes: c.quotes }, record.model, record.promptVersion, { inputTokens: c.inputTokens, outputTokens: c.outputTokens, attempts: c.drafts, estUsd: c.estUsd }, review, record.put?.generatedAt ?? record.replaces.generatedAt);
  record.put = { candidate: n, at: new Date().toISOString(), generatedAt, ...(await follow(record)) };
  writeFileSync(path, JSON.stringify(record, null, 1) + "\n");
  done(path);
}

async function restore() {
  const { path, record } = newestRecord();
  if (!record.put) { console.error(`nothing was stored from ${path}; the old note is still there`); process.exit(2); }
  const old = record.replaces;
  if (old.promptVersion !== hashPrompt()) { console.error(`the old note was written under style ${old.promptVersion} and the site now refuses it (${hashPrompt()})`); process.exit(2); }
  const generatedAt = await store({ summary: old.summary, question: old.question, quotes: old.quotes }, old.model, old.promptVersion, old.usage, old.review, record.put.generatedAt);
  record.restored = { at: new Date().toISOString(), generatedAt };
  await follow(record);
  writeFileSync(path, JSON.stringify(record, null, 1) + "\n");
  done(path);
}

async function store(note: NoteDraft, noteModel: string, promptVersion: string, usage: DafNote["usage"], review: unknown, replaces: string): Promise<string> {
  const { status, body } = await admin("/admin/note/put", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, daf: Number(dafStr), ...note, model: noteModel, promptVersion, usage, review, replaces }) });
  if (status !== 200) { console.error(`${key}: not stored (HTTP ${status}): ${body.reason ?? (body.problems ?? []).join(" | ")}`); process.exit(1); }
  console.log(`${key}: stored, generatedAt ${body.generatedAt}\n  ${note.question}`);
  return body.generatedAt as string;
}

/** The Hebrew note and the share card belong to one English bake; redo them when the old note had them. */
async function follow(record: RedraftRecord): Promise<{ translation?: string; card?: string }> {
  const out: { translation?: string; card?: string } = {};
  if (record.hadTranslation) {
    const { status, body } = await admin(`/admin/translate?slug=${slug}&daf=${dafStr}&lang=he&force=1`, { method: "POST" });
    out.translation = `${status} ${body.status ?? ""}${body.reason ? ` ${body.reason}` : ""}`.trim();
    console.log(`  Hebrew: ${out.translation}${body.judged ? `; judge ${body.judged.verdict}` : ""}${body.translation?.question ? `\n  ${body.translation.question}` : ""}`);
  }
  if (record.hadCard) {
    const { status, body } = await admin(`/admin/og/bake?slug=${slug}&daf=${dafStr}`, { method: "POST" });
    const o = body.outcomes?.[0];
    out.card = `${status} ${o?.status ?? ""}${o?.kind ? ` ${o.kind}` : ""}`.trim();
    console.log(`  card: ${out.card}${status === 429 ? " (the day's browser minutes are gone; the card cron catches up, and until then the page points at the static card)" : ""}`);
  }
  return out;
}

function done(path: string) {
  console.log(`\nrecord: ${path} (commit it)\ncheck: ${site}/${slug}/${dafStr}?nocache=1 · ${site}/he/${slug}/${dafStr}?nocache=1 · ${site}/api/${slug}/${dafStr}.json\nthe edge holds the old page for up to ten minutes on today's daf, an hour on a permalink`);
}

main().catch((e) => { console.error(e); process.exit(1); });
