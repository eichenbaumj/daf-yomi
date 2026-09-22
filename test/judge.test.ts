import { describe, expect, it } from "vitest";
import { JUDGE_SYSTEM, hashJudgePrompt, judgeRequest, judgeUserMessage, verifyJudgment, type JudgeRaw } from "../src/note/judge";

const page = `Rav Mari bar Raḥel would sell the ears of his firstborn animals to a gentile, and nevertheless give them to priests. Why did he do this? So that priests would not come to violate the prohibitions of shearing and working the animal. The Gemara asks: Why do I need all these examples in the mishna?`;
const input = { label: "Bekhorot 3", positionLine: "Seder Kodashim · Bekhorot · Chapter 1 of 9 · Daf 3 of 61", sections: [{ label: "Bekhorot 3a", text: "text a" }, { label: "Bekhorot 3b", text: page }] };
const note = { summary: "Rav Mari sold the ears and still gave the animals to priests.", question: "If Rav Mari still handed the animals to the priests, what did selling their ears change?" };
const raw = (over: Partial<JudgeRaw> = {}): JudgeRaw => ({
  strongestAnswer: { found: true, quote: "So that priests would not come to violate the prohibitions of shearing and working the animal", where: "Bekhorot 3b", explanation: "The Gemara states his purpose." },
  questionStatus: "answered-on-page", reach: "case", reachNote: "what a sale changes when nothing else does",
  summaryProblems: [], modelVerdict: "rebake", feedback: "Ask what remains once his reason is known.", ...over,
});

describe("judge", () => {
  it("re-bakes when the page's answer is really on the page", () => {
    const j = verifyJudgment(raw(), page);
    expect(j.verdict).toBe("rebake");
    expect(j.reasons).toEqual(["answered-on-page"]);
    expect(j.unverified).toBe(false);
    expect(j.answer?.where).toBe("Bekhorot 3b");
    expect(j.feedback).toContain('The page answers your question in Bekhorot 3b: "So that priests would not come');
    expect(j.feedback).toContain("Ask what remains once his reason is known.");
    expect(j.judgeVersion).toBe(hashJudgePrompt());
  });
  it("does not trust an answer it cannot point to", () => {
    const j = verifyJudgment(raw({ strongestAnswer: { found: true, quote: "he wanted to spare the priests embarrassment", where: "3b", explanation: "" } }), page);
    expect(j.verdict).toBe("keep");
    expect(j.questionStatus).toBe("partly-answered");
    expect(j.unverified).toBe(true);
    expect(j.answer).toBeNull();
    expect(j.feedback).toBe("");
  });
  it("is forgiving about case and punctuation in the quote", () => {
    const j = verifyJudgment(raw({ strongestAnswer: { found: true, quote: "so that priests would not come to violate the prohibitions", where: "3b", explanation: "" } }), page);
    expect(j.verdict).toBe("rebake");
  });
  it("keeps partly-answered and open questions, whatever the model's own verdict", () => {
    expect(verifyJudgment(raw({ questionStatus: "partly-answered" }), page).verdict).toBe("keep");
    expect(verifyJudgment(raw({ questionStatus: "open", strongestAnswer: { found: false, quote: "", where: "", explanation: "" }, modelVerdict: "rebake" }), page).verdict).toBe("keep");
  });
  it("re-bakes a mechanics question and names the idea under it", () => {
    const j = verifyJudgment(raw({ questionStatus: "open", strongestAnswer: { found: false, quote: "", where: "", explanation: "" }, reach: "mechanics", reachNote: "whether ownership is a matter of use or of title", modelVerdict: "rebake", feedback: "" }), page);
    expect(j.verdict).toBe("rebake");
    expect(j.reasons).toEqual(["mechanics"]);
    expect(j.feedback).toContain("only mechanics (whether ownership is a matter of use or of title)");
    expect(verifyJudgment(raw({ questionStatus: "open", strongestAnswer: { found: false, quote: "", where: "", explanation: "" }, reach: "idea" }), page).verdict).toBe("keep");
  });
  it("re-bakes a summary the page contradicts, but only on verified page words", () => {
    const wrong = { claim: "Rav Mari never gave the animals to priests", pageSays: "and nevertheless give them to priests" };
    const j = verifyJudgment(raw({ questionStatus: "open", strongestAnswer: { found: false, quote: "", where: "", explanation: "" }, summaryProblems: [wrong] }), page);
    expect(j.verdict).toBe("rebake");
    expect(j.reasons).toEqual(["summary-wrong"]);
    expect(j.feedback).toContain('The summary says "Rav Mari never gave the animals to priests", but the page says "and nevertheless give them to priests"');
    const invented = verifyJudgment(raw({ questionStatus: "open", strongestAnswer: { found: false, quote: "", where: "", explanation: "" }, summaryProblems: [{ claim: "x", pageSays: "words that are not there" }] }), page);
    expect(invented.verdict).toBe("keep");
    expect(invented.unverified).toBe(true);
    expect(invented.summaryProblems).toEqual([]);
  });
  it("shows the judge the whole page, then the note, and asks for the structured fields", () => {
    const m = judgeUserMessage(input, note);
    expect(m.indexOf("### Bekhorot 3a")).toBeLessThan(m.indexOf("### Bekhorot 3b"));
    expect(m.indexOf("### Bekhorot 3b")).toBeLessThan(m.indexOf("THE NOTE"));
    expect(m).toContain(`SUMMARY: ${note.summary}`);
    expect(m).toContain(`QUESTION: ${note.question}`);
    expect(m).toMatch(/Return only the structured fields\.$/);
    const req = judgeRequest("claude-opus-5", input, note);
    expect(req.system).toBe(JUDGE_SYSTEM);
    expect(req.messages[0]!.content).toBe(m);
    expect(JUDGE_SYSTEM).toContain("strongest answer");
    expect(JUDGE_SYSTEM).not.toMatch(/—/);
  });
  it("versions the judge prompt like the note prompt", () => {
    expect(hashJudgePrompt()).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+-[0-9a-f]+$/);
  });
});
