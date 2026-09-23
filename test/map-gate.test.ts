import { describe, expect, it } from "vitest";
import { checkMap } from "../src/map/gate";
import { cueSegments, sourceTextOf, type MapSection } from "../src/map/cues";
import type { MapDraft } from "../src/map/prompt";
import { sec } from "./map-cues.test";

const sections: MapSection[] = [
  sec("Bekhorot 2a", "a", [
    "MISHNA: With regard to one who purchases the fetus of a donkey that belongs to a gentile, the donkeys are exempt from the obligations of firstborn status.",
    "GEMARA: The Gemara asks: Why do I need all these examples in the mishna?",
    "Rav Huna said: each case teaches something the others do not.",
    "The Gemara accepts this.",
  ]),
  sec("Bekhorot 2b", "b", [
    "Rav Huna said: even the animal's ear is enough of a share.",
    "§ Rav Ḥisda said: only a part the animal could not live without.",
    "The dispute stands.",
  ]),
];
const page = { sections, cues: cueSegments(sections) };
const source = sourceTextOf(sections);

const good: MapDraft = {
  units: [
    { from: "a-1", to: "a-1", kind: "mishna", title: "Five who owe nothing for a donkey", gloss: "The mishna lists five ways a Jew and a gentile share a donkey, and in each the firstborn owes nothing." },
    { from: "a-2", to: "a-4", kind: "question", title: "Why five cases and not one", gloss: "The Gemara asks why the mishna needs every case when one principle would do, and Rav Huna answers." },
    { from: "b-1", to: "b-1", kind: "case", title: "An ear as a share", gloss: "Rav Huna says even the animal's ear counts as the gentile's share." },
    { from: "b-2", to: "b-3", kind: "dispute", title: "Rav Huna against Rav Hisda", gloss: "Rav Ḥisda wants a part the animal cannot live without, and the page leaves the two views standing." },
  ],
  shape: "A mishna with five cases, one question about why five, and a dispute over how small a gentile's share can be.",
};
const withUnit = (i: number, over: Partial<MapDraft["units"][number]>): MapDraft => ({ ...good, units: good.units.map((u, j) => (j === i ? { ...u, ...over } : u)) });
const problems = (d: MapDraft) => checkMap(d, page, source).problems;

describe("map gate", () => {
  it("passes a good map", () => {
    expect(checkMap(good, page, source)).toEqual({ ok: true, problems: [] });
    expect(page.cues).toEqual([{ id: "a-1", mark: "mishna" }, { id: "a-2", mark: "gemara" }, { id: "b-2", mark: "sugya" }]);
  });
  it("wants the units to chain over the whole page", () => {
    expect(problems(withUnit(1, { from: "a-3" }))).toContainEqual(expect.stringMatching(/gap: segments a-2 to a-2/));
    expect(problems(withUnit(1, { from: "a-1" }))).toContainEqual(expect.stringMatching(/overlap: unit 2 starts at a-1/));
    expect(problems(withUnit(1, { from: "a-4", to: "a-2" }))).toContainEqual(expect.stringMatching(/ends at a-2, before it starts at a-4/));
    expect(problems(withUnit(0, { from: "a-2", to: "a-2" }))).toContainEqual(expect.stringMatching(/first unit must start at a-1/));
    expect(problems(withUnit(3, { to: "b-2" }))).toContainEqual(expect.stringMatching(/last unit ends at b-2; the page runs to b-3/));
    expect(problems(withUnit(3, { to: "c-9" }))).toContainEqual(expect.stringMatching(/"c-9", which is not a segment/));
    expect(problems({ ...good, units: [] })).toContainEqual("the map has no units.");
  });
  it("allows a unit to cross from one side to the other", () => {
    const crossing: MapDraft = { ...good, units: [good.units[0]!, { ...good.units[1]!, to: "b-1" }, good.units[3]!] };
    expect(checkMap(crossing, page, source).ok).toBe(true);
  });
  it("makes the text's own marks begin units", () => {
    const merged: MapDraft = { ...good, units: [{ ...good.units[0]!, to: "a-4", gloss: good.units[1]!.gloss }, good.units[2]!, good.units[3]!] };
    expect(problems(merged)).toContainEqual("segment a-2 carries a GEMARA mark and must begin a unit.");
    expect(problems(withUnit(0, { kind: "question" }))).toContainEqual(expect.stringMatching(/begins at MISHNA: and must be of kind mishna, not question/));
    const noSugya: MapDraft = { ...good, units: [good.units[0]!, good.units[1]!, { ...good.units[2]!, to: "b-3", kind: "dispute" }] };
    expect(problems(noSugya)).toContainEqual("segment b-2 carries a § mark and must begin a unit.");
  });
  it("rejects a kind outside the vocabulary", () => {
    expect(problems(withUnit(2, { kind: "lesson" as never }))).toContainEqual(expect.stringMatching(/kind "lesson", which is not one of: mishna, reading/));
  });
  it("holds the caps", () => {
    expect(problems(withUnit(2, { title: "one two three four five six seven eight nine ten eleven" }))).toContainEqual(expect.stringMatching(/title is 11 words; at most 10/));
    expect(problems(withUnit(2, { gloss: "w ".repeat(25).trim() }))).toContainEqual(expect.stringMatching(/gloss is 25 words/));
    expect(checkMap(withUnit(2, { gloss: "w ".repeat(22).trim() }), page, source).ok).toBe(true); // a little past twenty is tolerated
    expect(checkMap(withUnit(2, { gloss: "Rav Huna says the ear counts. The page agrees with him." }), page, source).ok).toBe(true); // two short sentences are fine; the word cap bounds it
    expect(problems(withUnit(2, { title: "A case" }))).toContainEqual(expect.stringMatching(/only the kind's name/));
    expect(problems(withUnit(2, { title: "Left open" }))).toContainEqual(expect.stringMatching(/only the kind's name/));
    expect(problems(withUnit(2, { title: good.units[0]!.title }))).toContainEqual(expect.stringMatching(/is used twice/));
    expect(problems({ ...good, shape: "w ".repeat(35).trim() })).toContainEqual(expect.stringMatching(/shape sentence is 35 words/));
    expect(problems({ ...good, shape: "This page opens with a mishna about donkeys and then asks why there are five cases." })).toContainEqual(expect.stringMatching(/do not open the shape/));
  });
  it("applies the note's rules to every string", () => {
    expect(problems(withUnit(2, { gloss: "Rav Huna says the ear counts — a small share." }))).toContainEqual("unit 3: no em dashes.");
    expect(problems(withUnit(2, { gloss: "The Gemara delves into what an ear is worth as a share." }))).toContainEqual("unit 3: banned word: delve.");
    expect(problems(withUnit(2, { gloss: "A fortiori the ear is a share, says Rav Huna." }))).toContainEqual('unit 3: banned phrase: "a fortiori".');
    expect(problems(withUnit(2, { gloss: "Rashi explains that the ear counts as a share for Rav Huna." }))).toContainEqual("unit 3: do not cite later authorities, Steinsaltz, or Sefaria.");
    expect(problems(withUnit(2, { gloss: "Rav Yosef says the ear counts as a share for the gentile." }))).toContainEqual(expect.stringMatching(/^unit 3: "Rav Yosef" is not named on this page/));
    expect(problems(withUnit(2, { gloss: 'Rav Huna calls it "a share in the donkey itself" and moves on.' }))).toContainEqual(expect.stringMatching(/^unit 3: quoted phrase not found/));
    expect(problems(withUnit(2, { gloss: "Rav Huna says the ear counts, like teruma for a priest." }))).toContainEqual(expect.stringMatching(/^unit 3: gloss "teruma"/));
    expect(problems(withUnit(2, { gloss: "Rav Huna says a uprooted ear still counts as a share." }))).toContainEqual(expect.stringMatching(/^unit 3: article does not agree/));
    expect(problems(withUnit(2, { gloss: "Rav Huna says the ear counts, so the donkey is exempt." }))).toContainEqual(expect.stringMatching(/^unit 3: legal verb left hanging/));
    expect(checkMap(withUnit(2, { gloss: "Rav Huna says the ear exempts the Israelites' donkeys from the priest's claim." }), page, source).ok).toBe(true); // a direct object satisfies the map's rule
  });
  it("counts a term glossed once anywhere in the map", () => {
    const glossedOnce = withUnit(1, { gloss: "The Gemara asks why the mishna needs every case, like teruma, the priest's share of the crop, needs a rule." });
    const laterBare = { ...glossedOnce, units: glossedOnce.units.map((u, j) => (j === 3 ? { ...u, gloss: "Rav Ḥisda wants a part the animal cannot live without, as with teruma." } : u)) };
    expect(checkMap(laterBare, page, source).ok).toBe(true);
  });
});
