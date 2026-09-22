import { describe, expect, it } from "vitest";
import { decideHe, formatEntryHe, pickForReviewHe, summarizeHe, type AuditHeEntry } from "../scripts/lib/audit-he";

const entry = (over: Partial<AuditHeEntry> = {}): AuditHeEntry => ({ key: "bekhorot/4", date: "2026-09-22", promptVersion: "2026-09-22.1-abc", generatedAt: "t", current: true, summary: "ס.", question: "ש?", english: { summary: "S.", question: "Q?" }, screens: [], score: 0, rebake: false, why: [], ...over });
const judge = (over: Partial<NonNullable<AuditHeEntry["judge"]>> = {}): NonNullable<AuditHeEntry["judge"]> => ({ fidelity: [], language: [], sameQuestion: true, naturalness: 4, verdict: "keep", reasons: [], unverified: false, modelVerdict: "keep", feedback: "", ...over });

describe("Hebrew audit decisions", () => {
  it("re-translates on the judge's verdict and says why; a stale translation is counted, not re-baked", () => {
    expect(decideHe(entry())).toEqual({ rebake: false, why: [] });
    expect(decideHe(entry({ judge: judge({ verdict: "rebake", reasons: ["fidelity", "language"] }) }))).toEqual({ rebake: true, why: ["fidelity", "language"] });
    expect(decideHe(entry({ current: false }))).toEqual({ rebake: false, why: [] });
  });
  it("counts what the run found, with a naturalness histogram", () => {
    const c = summarizeHe([
      entry({ rebake: true, why: ["language"], judge: judge({ naturalness: 2, verdict: "rebake", reasons: ["language"] }), screens: ["calque"] }),
      entry({ current: false, judge: judge({ naturalness: 5, unverified: true }) }),
      entry({ judgeError: "refused" }),
    ]);
    expect(c).toMatchObject({ total: 3, rebake: 1, keep: 2, stale: 1, judged: 2, language: 1, fidelity: 0, unverified: 1, "judge-error": 1, "naturalness:1": 0, "naturalness:2": 1, "naturalness:5": 1, "screen:calque": 1 });
  });
  it("picks a spread to read by hand and formats an entry", () => {
    const entries = Array.from({ length: 40 }, (_, i) => entry({ key: `k/${i}`, rebake: i % 2 === 0, why: i % 2 === 0 ? ["fidelity"] : [], judge: judge({ naturalness: i % 2 === 0 ? 3 : 5, verdict: i % 2 === 0 ? "rebake" : "keep", reasons: i % 2 === 0 ? ["fidelity"] : [] }) }));
    const picks = pickForReviewHe(entries, 5);
    expect(picks.fidelity!.length).toBe(5);
    expect(picks.keep!.length).toBe(5);
    expect(picks.language).toEqual([]);
    expect(formatEntryHe(entries[0]!)).toContain("REBAKE: fidelity");
    expect(formatEntryHe(entry({ current: false }))).toContain("STALE");
    expect(formatEntryHe(entry({ judge: judge({ language: [{ hebrew: "א", kind: "calque", better: "ב" }] }) }))).toContain('calque: "א" → "ב"');
  });
});
