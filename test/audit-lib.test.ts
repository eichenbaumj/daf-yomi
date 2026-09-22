import { describe, expect, it } from "vitest";
import { decide, formatEntry, pickForReview, summarize, type AuditEntry } from "../scripts/lib/audit";
import { canWrite } from "../scripts/lib/budget";

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({ key: "bekhorot/3", date: "2026-09-21", promptVersion: "v", generatedAt: "t", summary: "S.", question: "Q?", screens: [], score: 0, gate: [], rebake: false, why: [], ...over });
const judge = (over: Partial<NonNullable<AuditEntry["judge"]>> = {}): NonNullable<AuditEntry["judge"]> => ({ questionStatus: "open", reach: "case", reachNote: "", answer: null, summaryProblems: [], verdict: "keep", reasons: [], unverified: false, modelVerdict: "keep", feedback: "", ...over });

describe("audit decisions", () => {
  it("re-bakes on the gate or the judge, and says why", () => {
    expect(decide(entry())).toEqual({ rebake: false, why: [] });
    expect(decide(entry({ gate: ["no em dashes."] }))).toEqual({ rebake: true, why: ["gate"] });
    expect(decide(entry({ judge: judge({ verdict: "rebake", reasons: ["answered-on-page", "mechanics"] }) }))).toEqual({ rebake: true, why: ["answered-on-page", "mechanics"] });
    expect(decide(entry({ judge: judge({ questionStatus: "partly-answered" }) }))).toEqual({ rebake: false, why: [] });
  });
  it("counts what the run found", () => {
    const c = summarize([entry({ rebake: true, why: ["gate"], gate: ["x"], screens: ["mechanics"] }), entry({ judge: judge({ reach: "idea", unverified: true }) }), entry({ judgeError: "refused" })]);
    expect(c).toMatchObject({ total: 3, rebake: 1, keep: 2, gate: 1, idea: 1, open: 1, unverified: 1, "judge-error": 1, "screen:mechanics": 1 });
  });
  it("picks a spread to read by hand", () => {
    const entries = Array.from({ length: 40 }, (_, i) => entry({ key: `k/${i}`, rebake: i % 2 === 0, why: i % 2 === 0 ? ["answered-on-page"] : [], judge: judge({ questionStatus: i % 2 === 0 ? "answered-on-page" : "open" }) }));
    const picks = pickForReview(entries, 5);
    expect(picks["answered-on-page"]!.length).toBe(5);
    expect(picks.keep!.length).toBe(5);
    expect(picks.mechanics).toEqual([]);
    expect(formatEntry(entries[0]!)).toContain("REBAKE: answered-on-page");
  });
});

describe("KV write budget", () => {
  it("counts only today's writes", () => {
    const now = new Date("2026-09-23T10:00:00Z");
    expect(canWrite({ date: "2026-09-23", count: 849 }, 850, now)).toBe(true);
    expect(canWrite({ date: "2026-09-23", count: 850 }, 850, now)).toBe(false);
    expect(canWrite({ date: "2026-09-22", count: 900 }, 850, now)).toBe(true); // yesterday's writes do not count
  });
});
