import { describe, expect, it } from "vitest";
import { ensureNote, type DraftResult, type GenerateDeps, type JudgeResult } from "../src/note/generate";
import { noteKey, type DafNote } from "../src/note/store";
import { hashPrompt, type NoteDraft } from "../src/note/prompt";
import { hashJudgePrompt, type Judgment } from "../src/note/judge";
import { dafForDate } from "../src/daf/schedule";
import type { Env } from "../src/types";
import { FakeKV } from "./helpers/fakeKv";

const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y!, m! - 1, dd!); };
const ref = dafForDate(d("2026-09-21")); // Bekhorot 3
const sourceText = `MISHNA: With regard to one who purchases the fetus of a donkey that belongs to a gentile, the donkeys are exempt from the obligations of firstborn status. GEMARA: Rav Mari bar Raḥel would sell the ears of his firstborn animals to a gentile, and nevertheless give them to priests. Why did he do this? So that priests would not come to violate the prohibitions of shearing and working the animal. `.repeat(2);
const usage = { inputTokens: 100, outputTokens: 10 };
const goodDraft: NoteDraft = { summary: "A firstborn male animal belongs to the priest and may not be sheared or worked, unless a gentile owns a share of it. Rav Mari sold the ears of his animals to a gentile and still gave the animals to priests, so that the priests would not sin with them.", question: "If the sale spared the priests a sin, what does it cost the animal's holiness?", quotes: [] };
const badDraft: NoteDraft = { ...goodDraft, question: "Isn't it strange that Rav Mari sold the ears at all?" };
const judgment = (over: Partial<Judgment> = {}): Judgment => ({ judgeVersion: hashJudgePrompt(), questionStatus: "open", reach: "case", reachNote: "", answer: null, summaryProblems: [], verdict: "keep", reasons: [], unverified: false, modelVerdict: "keep", feedback: "", ...over });
const rebake = judgment({ questionStatus: "answered-on-page", verdict: "rebake", reasons: ["answered-on-page"], modelVerdict: "rebake", feedback: "The page answers your question in 3b. Ask what remains." });

function harness(drafts: NoteDraft[], judgments: Judgment[] = []) {
  const kv = new FakeKV();
  const env = { DAF_KV: kv as unknown as KVNamespace, ANTHROPIC_API_KEY: "k", NOTE_MODEL: "m", DAILY_GENERATION_CAP: "12" } as unknown as Env;
  const seen: { draftInputs: string[]; judgeCalls: number } = { draftInputs: [], judgeCalls: 0 };
  const deps: GenerateDeps = {
    buildInput: async () => ({ input: { label: "Bekhorot 3", positionLine: "p", sections: [{ label: "Bekhorot 3a", text: sourceText }] }, sources: ["Bekhorot.3a"], sourceText }),
    draft: async (input): Promise<DraftResult> => { seen.draftInputs.push(input.feedback ?? ""); return { draft: drafts.shift() ?? null, usage }; },
    judge: async (): Promise<JudgeResult> => { seen.judgeCalls++; return { judgment: judgments.shift() ?? null, usage }; },
  };
  const stored = () => kv.get(noteKey(ref.tractate, ref.daf), "json") as Promise<DafNote | null>;
  return { env, deps, seen, kv, stored };
}

describe("ensureNote", () => {
  it("retries once with the gate's feedback and stores the grounded draft (no judge)", async () => {
    const h = harness([badDraft, goodDraft]);
    const out = await ensureNote(h.env, ref, {}, h.deps);
    expect(out.status).toBe("generated");
    if (out.status !== "generated") return;
    expect(out.attempts).toBe(2);
    expect(out.firstAttemptProblems).toContainEqual(expect.stringMatching(/rhetorical/));
    expect(h.seen.draftInputs[1]).toMatch(/rhetorical/);
    expect(h.seen.judgeCalls).toBe(0);
    const note = await h.stored();
    expect(note?.question).toBe(goodDraft.question);
    expect(note?.promptVersion).toBe(hashPrompt());
    expect(note?.review).toBeUndefined();
    expect(note?.usage?.inputTokens).toBe(200);
  });
  it("gives up after two ungrounded drafts and stores nothing", async () => {
    const h = harness([badDraft, badDraft, goodDraft]);
    const out = await ensureNote(h.env, ref, {}, h.deps);
    expect(out.status).toBe("failed");
    expect(await h.stored()).toBeNull();
    expect(h.seen.draftInputs.length).toBe(2);
  });
  it("with judge: once, a kept verdict is recorded on the note", async () => {
    const h = harness([goodDraft], [judgment()]);
    const out = await ensureNote(h.env, ref, { judge: "once" }, h.deps);
    expect(out.status).toBe("generated");
    expect(h.seen.judgeCalls).toBe(1);
    const note = await h.stored();
    expect(note?.review).toMatchObject({ judgeVersion: hashJudgePrompt(), questionStatus: "open", reach: "case", verdict: "keep", rewritten: false });
    expect(note?.review?.unverified).toBeUndefined();
    expect(note?.usage?.inputTokens).toBe(200); // the judge's tokens count
  });
  it("with judge: once, a rebake verdict writes one more draft with the judge's feedback and judges only once", async () => {
    const second: NoteDraft = { ...goodDraft, question: "Once the sale has spared the priests a sin, what is left of the animal's holiness for them to honour?" };
    const h = harness([goodDraft, second], [rebake, judgment()]);
    const out = await ensureNote(h.env, ref, { judge: "once" }, h.deps);
    expect(out.status).toBe("generated");
    if (out.status !== "generated") return;
    expect(out.attempts).toBe(2);
    expect(h.seen.judgeCalls).toBe(1);
    expect(h.seen.draftInputs[1]).toBe(rebake.feedback);
    const note = await h.stored();
    expect(note?.question).toBe(second.question);
    expect(note?.review).toMatchObject({ questionStatus: "answered-on-page", verdict: "rebake", rewritten: true });
  });
  it("bounds the loop at three drafts and one judge, and keeps the old note when the rewrite never grounds", async () => {
    const h = harness([goodDraft, badDraft, badDraft, goodDraft], [rebake]);
    const old: DafNote = { ...goodDraft, question: "Old?", model: "m", promptVersion: "old", generatedAt: "2026-09-01T00:00:00Z", sources: [] };
    await h.kv.put(noteKey(ref.tractate, ref.daf), JSON.stringify(old));
    const out = await ensureNote(h.env, ref, { force: true, judge: "once" }, h.deps);
    expect(out.status).toBe("failed");
    if (out.status !== "failed") return;
    expect(out.judged?.verdict).toBe("rebake");
    expect(h.seen.draftInputs.length).toBe(3);
    expect(h.seen.judgeCalls).toBe(1);
    expect((await h.stored())?.question).toBe("Old?");
  });
  it("stores the grounded rewrite on the third draft when the second fails the gate", async () => {
    const third: NoteDraft = { ...goodDraft, question: "What is left for the priests once the sale has spared them the sin?" };
    const h = harness([goodDraft, badDraft, third], [rebake]);
    const out = await ensureNote(h.env, ref, { judge: "once" }, h.deps);
    expect(out.status).toBe("generated");
    if (out.status !== "generated") return;
    expect(out.attempts).toBe(3);
    expect((await h.stored())?.review).toMatchObject({ verdict: "rebake", rewritten: true });
  });
  it("a judge with no verdict does not stop the note", async () => {
    const h = harness([goodDraft], []);
    const out = await ensureNote(h.env, ref, { judge: "once" }, h.deps);
    expect(out.status).toBe("generated");
    expect((await h.stored())?.review).toBeUndefined();
  });
  it("respects the daily cap and the exists short-circuit", async () => {
    const h = harness([goodDraft]);
    await h.kv.put(`gen:${new Date().toISOString().slice(0, 10)}`, "12");
    expect((await ensureNote(h.env, ref, {}, h.deps)).status).toBe("skipped");
    const h2 = harness([goodDraft]);
    await h2.kv.put(noteKey(ref.tractate, ref.daf), JSON.stringify({ ...goodDraft, model: "m", promptVersion: "v", generatedAt: "t", sources: [] }));
    expect((await ensureNote(h2.env, ref, {}, h2.deps)).status).toBe("exists");
  });
});
