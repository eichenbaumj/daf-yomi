/** The Hebrew audit file's shape and the pure decisions in it, kept apart from scripts/audit-he.ts so they can be tested. */
import type { ScreenFlagHe } from "../../src/note/screenHe";
import type { TranslationJudgment } from "../../src/note/tjudge";

export interface AuditHeEntry {
  key: string;
  date: string;
  /** The translation's style and bake, and whether it still belongs to the English note stored beside it. */
  promptVersion: string;
  generatedAt: string;
  current: boolean;
  summary: string;
  question: string;
  english: { summary: string; question: string };
  screens: ScreenFlagHe[];
  score: number;
  judge?: Omit<TranslationJudgment, "judgeVersion"> & { usage?: { inputTokens: number; outputTokens: number } };
  judgeError?: string;
  rebake: boolean;
  why: string[];
}

export interface AuditHeFile {
  generatedAt: string;
  site: string;
  model: string;
  promptVersion: string;
  judgeVersion: string;
  counts: Record<string, number>;
  estUsd: number;
  dapim: Record<string, AuditHeEntry>;
}

/** Re-translate when the judge sends it back; a stale translation is retired on its own and is counted, not re-baked here. */
export function decideHe(e: Pick<AuditHeEntry, "judge">): { rebake: boolean; why: string[] } {
  const why: string[] = e.judge?.verdict === "rebake" ? [...e.judge.reasons] : [];
  return { rebake: why.length > 0, why };
}

export function summarizeHe(entries: AuditHeEntry[]): Record<string, number> {
  const c: Record<string, number> = { total: entries.length, rebake: 0, keep: 0, stale: 0, judged: 0, fidelity: 0, question: 0, language: 0, unverified: 0, "judge-error": 0, "naturalness:1": 0, "naturalness:2": 0, "naturalness:3": 0, "naturalness:4": 0, "naturalness:5": 0 };
  for (const e of entries) {
    c[e.rebake ? "rebake" : "keep"]!++;
    if (!e.current) c.stale!++;
    if (e.judgeError) c["judge-error"]!++;
    if (e.judge) {
      c.judged!++;
      c[`naturalness:${e.judge.naturalness}`] = (c[`naturalness:${e.judge.naturalness}`] ?? 0) + 1;
      for (const r of e.judge.reasons) c[r] = (c[r] ?? 0) + 1;
      if (e.judge.unverified) c.unverified!++;
    }
    for (const f of e.screens) c[`screen:${f}`] = (c[`screen:${f}`] ?? 0) + 1;
  }
  return c;
}

/** A spread of verdicts to read by hand before anything is re-translated. Deterministic given the order of `entries`. */
export function pickForReviewHe(entries: AuditHeEntry[], n = 10): Record<string, AuditHeEntry[]> {
  const spaced = (xs: AuditHeEntry[]) => { if (xs.length <= n) return xs; const step = xs.length / n; return Array.from({ length: n }, (_, i) => xs[Math.floor(i * step)]!); };
  return {
    fidelity: spaced(entries.filter((e) => e.why.includes("fidelity"))),
    question: spaced(entries.filter((e) => e.why.includes("question"))),
    language: spaced(entries.filter((e) => e.why.includes("language"))),
    "kept, naturalness 3 or below": spaced(entries.filter((e) => !e.rebake && e.judge !== undefined && e.judge.naturalness <= 3)),
    keep: spaced(entries.filter((e) => !e.rebake && e.judge !== undefined && e.judge.naturalness >= 4)),
  };
}

export function formatEntryHe(e: AuditHeEntry): string {
  const j = e.judge;
  const lines = [
    `--- ${e.key} (${e.date}, style ${e.promptVersion.split("-").slice(0, 2).join("-")}${e.current ? "" : ", STALE"}) ${e.rebake ? `REBAKE: ${e.why.join(", ")}` : "keep"}; screens: ${e.screens.length ? e.screens.join("+") : "clean"}`,
    `  EN: ${e.english.summary}`, `  EN Q: ${e.english.question}`,
    `  ${e.summary}`, `  Q: ${e.question}`,
  ];
  if (j) {
    lines.push(`  judge: naturalness ${j.naturalness}, ${j.verdict}${j.sameQuestion ? "" : ", not the same question"}${j.unverified ? ", UNVERIFIED span discounted" : ""}`);
    for (const f of j.fidelity) lines.push(`  fidelity: "${f.hebrew}" for "${f.english}": ${f.problem}`);
    for (const l of j.language) lines.push(`  ${l.kind}: "${l.hebrew}" → "${l.better}"`);
    if (j.feedback) lines.push(`  feedback: ${j.feedback}`);
  }
  if (e.judgeError) lines.push(`  judge error: ${e.judgeError}`);
  return lines.join("\n");
}
