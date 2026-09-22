/**
 * The judge of the map over stored maps: one Message Batch of second readings, the verdict derived in code
 * (src/map/judge.ts), a file in data/audit/ and a spread to read with Joe before the archive is drawn.
 *
 *   npm run maps:audit -- --window 7 | --dapim slug/daf,… | --all [--sample N] [--review] [--dry]
 *
 * Targets are dapim with a stored map (GET /admin/map); --sample N picks N of them at random (seeded by the day, so a
 * rerun judges the same sample). The page text comes from .cache/map-text/ (fetched once). Output:
 * data/audit/maps-<utcDay>.json with every verdict, and with --review the spread: redraw reasons, unverified
 * complaints, the maps to read first. Nothing is written to KV. Needs ANTHROPIC_API_KEY and ADMIN_TOKEN.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { adminJson, adminToken, anthropicClientOptions, flag, opt, pool, site } from "./lib/cli";
import { keyOf, parseTargets } from "./lib/targets";
import { pageMapText } from "./lib/text-cache";
import { runMessageBatch } from "./lib/batch";
import { hashMapJudgePrompt, MapJudgeSchema, mapJudgeRequest, verifyMapJudgment, type MapJudgment } from "../src/map/judge";
import { hashMapPrompt } from "../src/map/prompt";
import type { DafMap } from "../src/map/store";
import { estimateUsd } from "../src/note/generate";

const model = opt("model") ?? "claude-opus-5";
const sample = Number(opt("sample") ?? NaN);
const dry = flag("dry");
const review = flag("review");
const utcDay = new Date().toISOString().slice(0, 10);

interface Entry { key: string; generatedAt: string; promptVersion: string; units: number; shape: string; judge?: Omit<MapJudgment, "judgeVersion"> & { usage: { inputTokens: number; outputTokens: number } }; judgeError?: string }
interface AuditFile { generatedAt: string; site: string; model: string; mapPromptVersion: string; judgeVersion: string; estUsd: number; counts: Record<string, number>; dapim: Record<string, Entry> }

/** A small seeded shuffle so the same day's sample is the same sample. */
function pick<T>(items: T[], n: number, seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const rand = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a.slice(0, n);
}

async function main() {
  const all = [...parseTargets(opt, flag)];
  if (all.length === 0) { console.error("no targets: use --window N, --dapim slug/daf or --all"); process.exit(2); }
  const token = adminToken();
  const stored: { key: string; ref: (typeof all)[number][1]; map: DafMap }[] = [];
  await pool(all, 6, async ([key, ref]) => {
    const [slug, daf] = key.split("/");
    const { status, body } = await adminJson(token, `/admin/map?slug=${slug}&daf=${daf}`);
    if (status === 200 && body.map) stored.push({ key, ref, map: body.map as DafMap });
  });
  const chosen = Number.isFinite(sample) ? pick(stored, sample, utcDay) : stored;
  console.log(`${stored.length} of ${all.length} targets have a map; judging ${chosen.length}${dry ? " (dry run)" : ""}`);
  if (chosen.length === 0) return;
  const texts = new Map<string, Awaited<ReturnType<typeof pageMapText>>>();
  for (const c of chosen) texts.set(c.key, await pageMapText(c.ref));
  if (dry) { for (const c of chosen) console.log(`${c.key}: ${c.map.units.length} units, style ${c.map.promptVersion}`); return; }
  if (!process.env.ANTHROPIC_API_KEY) { console.error("needs ANTHROPIC_API_KEY"); process.exit(2); }
  const client = new Anthropic(anthropicClientOptions());
  const requests = chosen.map((c) => ({ custom_id: c.key.replace("/", "-"), params: mapJudgeRequest(model, { label: texts.get(c.key)!.input.label, positionLine: texts.get(c.key)!.input.positionLine, sections: texts.get(c.key)!.input.sections }, c.map) }));
  const results = await runMessageBatch(client, `map-judge-${utcDay}`, requests, MapJudgeSchema);

  const file: AuditFile = { generatedAt: new Date().toISOString(), site, model, mapPromptVersion: hashMapPrompt(), judgeVersion: hashMapJudgePrompt(), estUsd: 0, counts: {}, dapim: {} };
  const count = (k: string) => { file.counts[k] = (file.counts[k] ?? 0) + 1; };
  for (const c of chosen) {
    const r = results.get(c.key.replace("/", "-"));
    const entry: Entry = { key: c.key, generatedAt: c.map.generatedAt, promptVersion: c.map.promptVersion, units: c.map.units.length, shape: c.map.shape };
    count("total");
    if (!r?.parsed) { entry.judgeError = r?.error ?? "no result"; count("judge-error"); }
    else {
      file.estUsd += estimateUsd(model, r.usage.inputTokens, r.usage.outputTokens) / 2;
      const { judgeVersion: _v, ...j } = verifyMapJudgment(r.parsed, c.map, texts.get(c.key)!.input.sections, texts.get(c.key)!.sourceText);
      entry.judge = { ...j, usage: r.usage };
      count(j.verdict);
      for (const reason of j.reasons) count(reason);
      if (j.unverified) count("unverified");
      if (c.map.promptVersion !== hashMapPrompt()) count("old-style");
    }
    file.dapim[c.key] = entry;
  }
  file.estUsd = Math.round(file.estUsd * 10000) / 10000;
  mkdirSync("data/audit", { recursive: true });
  const out = `data/audit/maps-${utcDay}.json`;
  writeFileSync(out, JSON.stringify(file, null, 1));
  console.log(`\n${out}: ${JSON.stringify(file.counts)} ≈ $${file.estUsd.toFixed(2)} (batch price)`);
  if (review) {
    const entries = Object.values(file.dapim).filter((e) => e.judge);
    const show = (title: string, list: Entry[]) => { if (!list.length) return; console.log(`\n${title} (${list.length})`); for (const e of list.slice(0, 25)) console.log(`  ${e.key} [${e.units} units${e.judge!.unverified ? ", unverified" : ""}]: ${e.judge!.reasons.join(", ") || "keep"}${e.judge!.feedback ? ` · ${e.judge!.feedback.slice(0, 220)}` : ""}`); };
    show("Redraw", entries.filter((e) => e.judge!.verdict === "redraw"));
    show("Keep, but the judge pointed at words that are not there", entries.filter((e) => e.judge!.verdict === "keep" && e.judge!.unverified));
    show("Keep", entries.filter((e) => e.judge!.verdict === "keep" && !e.judge!.unverified));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
