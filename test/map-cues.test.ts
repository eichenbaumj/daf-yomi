import { describe, expect, it } from "vitest";
import { cueSegments, EMPTY_SEGMENT, numberedText, sectionAnchor, sectionsFrom, segmentIds, sourceTextOf, type MapSection } from "../src/map/cues";

export const sec = (label: string, anchor: string, texts: string[]): MapSection => ({ label, anchor, segments: texts.map((text, i) => ({ id: `${anchor}-${i + 1}`, text })) });

// The openings of Bekhorot 4's segments as the William Davidson text has them (shortened).
const bekhorot4 = [
  sec("Bekhorot 4a", "a", ["GEMARA: In stating: If the priests and Levites rendered exempt the firstborn of the Israelites in the wilderness", "Abaye said: the animals of the Levites exempted the animals of the Israelites.", "Rava said: the Levites themselves did."]),
  sec("Bekhorot 4b", "b", ["The Gemara answers with a verse.", "§ Rav Safra (4a) referred to the fact that the sanctity of the firstborn", "It was taught in a baraita.", "§ The Gemara resumes its discussion of the procedure for the redemption", "and the lamb is given to the priest.", "§ It was stated with regard to the sanctity of the firstborn in the wilderness"]),
];

describe("map cues", () => {
  it("numbers sections the way the page does, placeholders included", () => {
    expect([0, 1, 2, 3].map(sectionAnchor)).toEqual(["a", "b", "s3", "s4"]);
    const loaded = [{ label: "Bekhorot 4a", text: { en: ["x", "", "z"], he: ["1", "2", "3", "4"], enPlain: ["  x ", "", "z"] } }] as unknown as Parameters<typeof sectionsFrom>[0];
    const s = sectionsFrom(loaded);
    expect(s[0]!.anchor).toBe("a");
    expect(s[0]!.segments.map((g) => g.id)).toEqual(["a-1", "a-2", "a-3", "a-4"]);
    expect(s[0]!.segments.map((g) => g.text)).toEqual(["x", "", "z", ""]);
    expect(numberedText(s)).toMatch(/^### Bekhorot 4a\n\n\[a-1\] x\n\n\[a-2\] /);
    expect(numberedText(s)).toContain(`[a-2] ${EMPTY_SEGMENT}`);
    expect(sourceTextOf(s)).toBe("x\n\nz");
  });
  it("finds the text's own marks, in page order", () => {
    expect(cueSegments(bekhorot4)).toEqual([{ id: "a-1", mark: "gemara" }, { id: "b-2", mark: "sugya" }, { id: "b-4", mark: "sugya" }, { id: "b-6", mark: "sugya" }]);
    expect(segmentIds(bekhorot4)).toEqual(["a-1", "a-2", "a-3", "b-1", "b-2", "b-3", "b-4", "b-5", "b-6"]);
  });
  it("a § after the first character is no mark; a glued MISHNA: is; the Yerushalmi labels count", () => {
    const s = [sec("Berakhot 2a", "a", [
      "The Mishna opens with the laws of Shema: MISHNA: From when does one recite",
      "and a § in the middle of a segment",
      "the mishna: says (lowercase is prose)",
      "MISHNAH: a Yerushalmi day",
      "HALAKHAH: a Yerushalmi day",
      "the mishna's last words. GEMARA: begins here",
    ])];
    expect(cueSegments(s)).toEqual([{ id: "a-1", mark: "mishna" }, { id: "a-4", mark: "mishna" }, { id: "a-5", mark: "halakha" }, { id: "a-6", mark: "gemara" }]);
  });
  it("a page without marks yields none", () => {
    expect(cueSegments([sec("Shabbat 20b", "a", ["plain text", "more text"])])).toEqual([]);
  });
});
