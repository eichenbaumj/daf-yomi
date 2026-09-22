/** The audit file's shape and the pure decisions in it, kept apart from the scripts so they can be tested. */
import type { ScreenFlag } from "../../src/note/screen";
import type { Judgment } from "../../src/note/judge";

export interface AuditEntry {
  key: string;
  date: string;
  promptVersion: string;
  generatedAt: string;
  summary: string;
  question: string;
  screens: ScreenFlag[];
  score: number;
  /** Problems the current grounding gate finds in the stored note. */
  gate: string[];
  judge?: Omit<Judgment, "judgeVersion"> & { usage?: { inputTokens: number; outputTokens: number } };
  judgeError?: string;
  hadTranslation?: boolean;
  rebake: boolean;
  why: string[];
}

export interface AuditFile {
  generatedAt: string;
  site: string;
  model: string;
  promptVersion: string;
  judgeVersion: string;
  counts: Record<string, number>;
  estUsd: number;
  dapim: Record<string, AuditEntry>;
}

/** Re-bake when the gate fails the note or the judge sends it back; the reasons are the audit's vocabulary. */
export function decide(e: Pick<AuditEntry, "gate" | "judge">): { rebake: boolean; why: string[] } {
  const why: string[] = [];
  if (e.gate.length) why.push("gate");
  if (e.judge?.verdict === "rebake") why.push(...e.judge.reasons);
  return { rebake: why.length > 0, why };
}

export function summarize(entries: AuditEntry[]): Record<string, number> {
  const c: Record<string, number> = { total: entries.length, rebake: 0, keep: 0, gate: 0, "answered-on-page": 0, "partly-answered": 0, open: 0, idea: 0, case: 0, mechanics: 0, "summary-wrong": 0, unverified: 0, "judge-error": 0 };
  for (const e of entries) {
    c[e.rebake ? "rebake" : "keep"]!++;
    if (e.gate.length) c.gate!++;
    if (e.judgeError) c["judge-error"]!++;
    if (e.judge) {
      c[e.judge.questionStatus]!++;
      c[e.judge.reach]!++;
      if (e.judge.summaryProblems.length) c["summary-wrong"]!++;
      if (e.judge.unverified) c.unverified!++;
    }
    for (const f of e.screens) c[`screen:${f}`] = (c[`screen:${f}`] ?? 0) + 1;
  }
  return c;
}

/** A spread of verdicts to read by hand before the archive is touched. Deterministic given the order of `entries`. */
export function pickForReview(entries: AuditEntry[], n = 10): Record<string, AuditEntry[]> {
  const spaced = (xs: AuditEntry[]) => { if (xs.length <= n) return xs; const step = xs.length / n; return Array.from({ length: n }, (_, i) => xs[Math.floor(i * step)]!); };
  return {
    "answered-on-page": spaced(entries.filter((e) => e.why.includes("answered-on-page"))),
    mechanics: spaced(entries.filter((e) => e.why.includes("mechanics"))),
    "summary-wrong": spaced(entries.filter((e) => e.why.includes("summary-wrong"))),
    "partly-answered": spaced(entries.filter((e) => !e.rebake && e.judge?.questionStatus === "partly-answered")),
    keep: spaced(entries.filter((e) => !e.rebake && e.judge?.questionStatus === "open")),
  };
}

export function formatEntry(e: AuditEntry): string {
  const j = e.judge;
  const lines = [`--- ${e.key} (${e.date}, style ${e.promptVersion.split("-").slice(0, 2).join("-")}) ${e.rebake ? `REBAKE: ${e.why.join(", ")}` : "keep"}; screens: ${e.screens.length ? e.screens.join("+") : "clean"}`,
    `  ${e.summary}`, `  Q: ${e.question}`];
  if (e.gate.length) lines.push(`  gate: ${e.gate.join(" | ")}`);
  if (j) {
    lines.push(`  judge: ${j.questionStatus}, ${j.reach}${j.unverified ? ", UNVERIFIED quote discounted" : ""}; ${j.reachNote}`);
    if (j.answer) lines.push(`  answer on page (${j.answer.where}): "${j.answer.quote}"`);
    for (const p of j.summaryProblems) lines.push(`  summary says "${p.claim}"; page says "${p.pageSays}"`);
    if (j.feedback) lines.push(`  feedback: ${j.feedback}`);
  }
  if (e.judgeError) lines.push(`  judge error: ${e.judgeError}`);
  return lines.join("\n");
}
