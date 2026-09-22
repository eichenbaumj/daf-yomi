import { describe, expect, it } from "vitest";
import { hashMapJudgePrompt, MAP_JUDGE_PROMPT_VERSION, mapJudgeUserMessage, verifyMapJudgment, type MapJudgeRaw } from "../src/map/judge";
import { sourceTextOf, type MapSection } from "../src/map/cues";
import type { MapUnit } from "../src/map/store";
import { sec } from "./map-cues.test";

const sections: MapSection[] = [
  sec("Bekhorot 2a", "a", ["MISHNA: With regard to one who purchases the fetus of a donkey that belongs to a gentile.", "GEMARA: The Gemara asks: Why do I need all these examples in the mishna?", "Rav Huna said: each case teaches something the others do not.", "The Gemara accepts this."]),
  sec("Bekhorot 2b", "b", ["Rav Huna said: even the animal's ear is enough of a share.", "§ Rav Ḥisda said: only a part the animal could not live without.", "The dispute stands."]),
];
const source = sourceTextOf(sections);
const units: MapUnit[] = [
  { from: "a-1", to: "a-1", kind: "mishna", title: "Five who owe nothing for a donkey", gloss: "The mishna lists five ways a Jew and a gentile share a donkey." },
  { from: "a-2", to: "a-4", kind: "question", title: "Why five cases and not one", gloss: "The Gemara asks why the mishna needs every case, and Rav Huna answers." },
  { from: "b-1", to: "b-3", kind: "story", title: "Rav Huna against Rav Hisda", gloss: "Rav Huna says even an ear counts; Rav Yosef wants a part the animal cannot live without." },
];
const map = { units, shape: "A mishna, one question, and a dispute over how small a share can be." };
const raw = (over: Partial<MapJudgeRaw> = {}): MapJudgeRaw => ({ boundaries: [], kinds: [], glosses: [], shapeFits: true, shapeNote: "", modelVerdict: "keep", feedback: "", ...over });

describe("the judge of the map", () => {
  it("keeps a map it cannot fault", () => {
    const j = verifyMapJudgment(raw(), map, sections, source);
    expect(j.verdict).toBe("keep");
    expect(j.reasons).toEqual([]);
    expect(j.unverified).toBe(false);
    expect(j.feedback).toBe("");
    expect(j.judgeVersion).toMatch(new RegExp(`^${MAP_JUDGE_PROMPT_VERSION.replace(/\./g, "\\.")}-[0-9a-f]+$`));
    expect(hashMapJudgePrompt()).toBe(j.judgeVersion);
  });
  it("counts a boundary complaint only at a real segment that is not already a unit's start, with page words that are there", () => {
    const good = raw({ boundaries: [{ unit: 3, turnsAt: "b-2", pageSays: "only a part the animal could not live without", explanation: "the dispute begins here" }], modelVerdict: "redraw", feedback: "Split unit 3 at b-2." });
    const j = verifyMapJudgment(good, map, sections, source);
    expect(j.reasons).toEqual(["boundary"]);
    expect(j.feedback).toContain("Unit 3 should begin at b-2");
    expect(j.feedback).toContain("Split unit 3 at b-2.");
    for (const bad of [
      { unit: 3, turnsAt: "b-9", pageSays: "only a part the animal", explanation: "" },        // no such segment
      { unit: 3, turnsAt: "b-1", pageSays: "even the animal's ear", explanation: "" },        // already a unit's start
      { unit: 3, turnsAt: "b-2", pageSays: "the donkey was very tired", explanation: "" },    // words not on the page
      { unit: 9, turnsAt: "b-2", pageSays: "only a part the animal", explanation: "" },        // no such unit
    ]) {
      const d = verifyMapJudgment(raw({ boundaries: [bad], modelVerdict: "redraw", feedback: "x" }), map, sections, source);
      expect(d.verdict, JSON.stringify(bad)).toBe("keep");
      expect(d.unverified).toBe(true);
      expect(d.feedback).toBe("");
    }
  });
  it("counts a kind complaint only when it names a different kind and quotes the page", () => {
    const j = verifyMapJudgment(raw({ kinds: [{ unit: 3, is: "dispute", pageSays: "Rav Ḥisda said: only a part", explanation: "two sages" }], modelVerdict: "redraw", feedback: "" }), map, sections, source);
    expect(j.reasons).toEqual(["kind"]);
    expect(j.kinds[0]).toMatchObject({ unit: 3, is: "dispute", was: "story" });
    expect(j.feedback).toContain("Unit 3 is story on the map but the page shows dispute");
    const same = verifyMapJudgment(raw({ kinds: [{ unit: 3, is: "story", pageSays: "Rav Ḥisda said", explanation: "" }] }), map, sections, source);
    expect(same.verdict).toBe("keep");
    expect(same.unverified).toBe(true);
  });
  it("counts a gloss complaint only when the claim is really in the gloss and the page words are really on the page", () => {
    const j = verifyMapJudgment(raw({ glosses: [{ unit: 3, claim: "Rav Yosef wants a part", pageSays: "Rav Ḥisda said: only a part the animal could not live without", explanation: "wrong sage" }], modelVerdict: "redraw", feedback: "" }), map, sections, source);
    expect(j.reasons).toEqual(["gloss"]);
    expect(j.feedback).toContain('Unit 3 says "Rav Yosef wants a part", but the page says');
    const notInGloss = verifyMapJudgment(raw({ glosses: [{ unit: 3, claim: "Rav Pappa wants a part", pageSays: "Rav Ḥisda said", explanation: "" }] }), map, sections, source);
    expect(notInGloss.verdict).toBe("keep");
    expect(notInGloss.unverified).toBe(true);
  });
  it("redraws for a shape that does not fit, and never takes the model's word alone", () => {
    const j = verifyMapJudgment(raw({ shapeFits: false, shapeNote: "the page ends in a story", modelVerdict: "redraw", feedback: "Rewrite the shape." }), map, sections, source);
    expect(j.reasons).toEqual(["shape"]);
    expect(j.feedback).toContain("the page ends in a story");
    const wordAlone = verifyMapJudgment(raw({ modelVerdict: "redraw", feedback: "I would have drawn it differently." }), map, sections, source);
    expect(wordAlone.verdict).toBe("keep");
  });
  it("shows the judge the numbered page and the map", () => {
    const msg = mapJudgeUserMessage({ label: "Bekhorot 2", positionLine: "p", sections }, map);
    expect(msg).toContain("[a-2] GEMARA:");
    expect(msg).toContain("2. [a-2..a-4] question: Why five cases and not one. The Gemara asks");
    expect(msg).toContain(`SHAPE: ${map.shape}`);
  });
});
