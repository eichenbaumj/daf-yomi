import { describe, expect, it } from "vitest";
import { LANGUAGE_REBAKE_THRESHOLD, TJUDGE_SYSTEM, hashTranslateJudgePrompt, translationJudgeRequest, translationJudgeUserMessage, verifyTranslationJudgment, type TranslationJudgeRaw } from "../src/note/tjudge";

// Bekhorot 4 in the shape the native reader scored 60/100: English-shaped Hebrew ("צעיר מכדי", "אותה החלפה").
const english = {
  summary: "Rav Safra asks how the Levites' firstborn could redeem the Israelites' firstborn in the wilderness when a Levite under a month old was never counted. The Gemara answers from a verse: the firstborn of the Levites' animals stood in for the firstborn animals of Israel, and the same exchange exempted the Levites' own firstborn.",
  question: "If the exchange was a one-time event in the wilderness, why does it still exempt Levites today?",
};
const hebrew = {
  summary: "רב ספרא שואל איך בכורי הלוויים פדו את בכורי ישראל במדבר, כשלוי צעיר מכדי להימנות לא נמנה. הגמרא עונה מפסוק: בכורות בהמת הלוויים באו תחת בכורות בהמת ישראל, ואותה החלפה פטרה גם את בכורי הלוויים.",
  question: "אם החילופין היו מאורע חד־פעמי במדבר, למה הם פוטרים לוויים גם היום?",
};
const raw = (over: Partial<TranslationJudgeRaw> = {}): TranslationJudgeRaw => ({ fidelity: [], sameQuestion: true, language: [], naturalness: 4, modelVerdict: "keep", feedback: "", ...over });
const calque = { hebrew: "צעיר מכדי להימנות", kind: "calque" as const, better: "שעדיין לא נמנה" };
const abstractNoun = { hebrew: "אותה החלפה", kind: "vague" as const, better: "החילופין האלה" };
const dropped = { hebrew: "פטרה גם את בכורי הלוויים", english: "exempted the Levites' own firstborn", problem: "drops 'own'" };

describe("the Hebrew judge", () => {
  it("keeps a clean translation whatever the model's own verdict", () => {
    const j = verifyTranslationJudgment(raw({ modelVerdict: "rebake", feedback: "Rewrite it all." }), hebrew, english);
    expect(j.verdict).toBe("keep");
    expect(j.reasons).toEqual([]);
    expect(j.feedback).toBe("");
    expect(j.unverified).toBe(false);
    expect(j.naturalness).toBe(4);
    expect(j.judgeVersion).toBe(hashTranslateJudgePrompt());
  });
  it("discounts a span that is not in the translation and says so", () => {
    const j = verifyTranslationJudgment(raw({ language: [{ hebrew: "מילים שאינן בתרגום", kind: "calque", better: "x" }, calque] }), hebrew, english);
    expect(j.language).toEqual([calque]);
    expect(j.unverified).toBe(true);
    expect(j.verdict).toBe("keep");
  });
  it("one verified language problem keeps; two send it back with both in the feedback", () => {
    expect(LANGUAGE_REBAKE_THRESHOLD).toBe(2);
    const one = verifyTranslationJudgment(raw({ language: [calque], naturalness: 3 }), hebrew, english);
    expect(one.verdict).toBe("keep");
    expect(one.reasons).toEqual([]);
    const two = verifyTranslationJudgment(raw({ language: [calque, abstractNoun], naturalness: 2, modelVerdict: "rebake", feedback: "Re-say both sentences." }), hebrew, english);
    expect(two.verdict).toBe("rebake");
    expect(two.reasons).toEqual(["language"]);
    expect(two.feedback).toContain('"צעיר מכדי להימנות" reads as a calque; say "שעדיין לא נמנה".');
    expect(two.feedback).toContain('"אותה החלפה" is vague; say "החילופין האלה".');
    expect(two.feedback).toContain("Re-say both sentences.");
  });
  it("sends back a verified fidelity problem, but not one it cannot point to in both texts", () => {
    const j = verifyTranslationJudgment(raw({ fidelity: [dropped], modelVerdict: "rebake" }), hebrew, english);
    expect(j.verdict).toBe("rebake");
    expect(j.reasons).toEqual(["fidelity"]);
    expect(j.feedback).toContain(`The Hebrew says "פטרה גם את בכורי הלוויים" where the English says "exempted the Levites' own firstborn": drops 'own'.`);
    const badEnglish = verifyTranslationJudgment(raw({ fidelity: [{ ...dropped, english: "words the note never says" }], modelVerdict: "rebake" }), hebrew, english);
    expect(badEnglish.verdict).toBe("keep");
    expect(badEnglish.fidelity).toEqual([]);
    expect(badEnglish.unverified).toBe(true);
    const badHebrew = verifyTranslationJudgment(raw({ fidelity: [{ ...dropped, hebrew: "מילים שאינן בתרגום" }], modelVerdict: "rebake" }), hebrew, english);
    expect(badHebrew.verdict).toBe("keep");
    expect(badHebrew.unverified).toBe(true);
  });
  it("sends back a different question", () => {
    const j = verifyTranslationJudgment(raw({ sameQuestion: false, modelVerdict: "rebake" }), hebrew, english);
    expect(j.verdict).toBe("rebake");
    expect(j.reasons).toEqual(["question"]);
    expect(j.sameQuestion).toBe(false);
    expect(j.feedback).toContain("The Hebrew question is not the English question.");
  });
  it("carries the model's own feedback only when the verdicts agree, and only verified items", () => {
    const disagree = verifyTranslationJudgment(raw({ fidelity: [dropped], modelVerdict: "keep", feedback: "Model says keep." }), hebrew, english);
    expect(disagree.verdict).toBe("rebake");
    expect(disagree.feedback).not.toContain("Model says keep.");
    const agree = verifyTranslationJudgment(raw({ fidelity: [dropped], language: [{ hebrew: "לא בטקסט", kind: "archaic", better: "y" }], modelVerdict: "rebake", feedback: "Model says rebake." }), hebrew, english);
    expect(agree.feedback).toContain("Model says rebake.");
    expect(agree.feedback).not.toContain("לא בטקסט");
    expect(agree.unverified).toBe(true);
  });
  it("is forgiving about vowels, a maqaf and punctuation in the span", () => {
    const j = verifyTranslationJudgment(raw({ language: [{ hebrew: "צָעִיר מִכְּדֵי", kind: "calque", better: "x" }, { hebrew: "חד פעמי", kind: "register", better: "y" }] }), hebrew, english);
    expect(j.language.length).toBe(2);
    expect(j.unverified).toBe(false);
    expect(j.verdict).toBe("rebake");
  });
  it("shows the judge both notes and asks for the structured fields, with no page text", () => {
    const m = translationJudgeUserMessage("Bekhorot 4", english, hebrew);
    expect(m).toContain(`SUMMARY: ${english.summary}`);
    expect(m).toContain(`QUESTION: ${english.question}`);
    expect(m).toContain(`SUMMARY: ${hebrew.summary}`);
    expect(m).toContain(`QUESTION: ${hebrew.question}`);
    expect(m.indexOf(english.summary)).toBeLessThan(m.indexOf("THE HEBREW TRANSLATION"));
    expect(m.indexOf("THE HEBREW TRANSLATION")).toBeLessThan(m.indexOf(hebrew.summary));
    expect(m).toMatch(/Return only the structured fields\.$/);
    expect(m.length).toBeLessThan(english.summary.length + english.question.length + hebrew.summary.length + hebrew.question.length + 400);
    const req = translationJudgeRequest("claude-opus-5", "Bekhorot 4", english, hebrew);
    expect(req.system).toBe(TJUDGE_SYSTEM);
    expect(req.max_tokens).toBe(8000); // Opus 5 thinks first and the thinking counts; 2,000 cut the first live verdict off
    expect(req.messages[0]!.content).toBe(m);
    expect(TJUDGE_SYSTEM).toContain("Fidelity");
    expect(TJUDGE_SYSTEM).not.toMatch(/—/);
  });
  it("versions the judge prompt like the note prompt", () => {
    expect(hashTranslateJudgePrompt()).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+-[0-9a-f]+$/);
    expect(hashTranslateJudgePrompt()).toMatch(/^2026-09-22\.1-/);
  });
});
