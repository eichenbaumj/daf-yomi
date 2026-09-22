import { describe, expect, it } from "vitest";
import { screenLabel, screenNote } from "../src/note/screen";

// The two live notes an outside review named on 2026-09-22, as stored that day.
const bekhorot3 = {
  summary: "A firstborn male animal belongs to the priest and may not be sheared or put to work, but if a gentile owns a share of it, none of that applies. Rav Huna says owning the animal's ear is enough; Rav Naḥman objects that the priest could simply tell the gentile to take his ear and go. Rav Mari bar Raḥel sold the ears of unborn animals to a gentile, still gave them to priests, and his flock died.",
  question: "If Rav Mari still handed the animals over to the priests and kept them from shearing and work, what did selling their ears actually change?",
};
const shabbat31 = {
  summary: "Two men bet four hundred zuz, a serious sum of silver, that one of them could provoke Hillel into losing his temper; the man tries three times with questions about oval heads and wide feet, and fails. Then three gentiles arrive with impossible conditions: teach me only the Written Torah, teach me the whole Torah while I stand on one foot, make me High Priest. Shammai drives each away with his builder's measuring stick; Hillel accepts every condition and then works around it.",
  question: "Hillel converted the third man on condition that he be installed as High Priest, something Hillel never arranges; is a promise kept when the one who made it simply teaches you to stop wanting it?",
};

describe("screens", () => {
  it("flags the reviewed notes", () => {
    expect(screenNote(bekhorot3).flags).toContain("reason-seeking");
    expect(screenNote(bekhorot3).flags).toContain("soft-rhetorical"); // "actually"
    expect(screenNote(shabbat31).flags).toContain("soft-rhetorical");
    expect(screenNote(bekhorot3).score).toBeGreaterThan(0);
  });
  it("tells a mechanics question from one with an idea in it (Joe's two examples)", () => {
    const zuz = { summary: "Four hundred zuz, silver coins, change hands.", question: "How many zuz does Yoḥanan owe Kontrokos if the donkey has a missing ear lobe?" };
    expect(screenNote(zuz).flags).toEqual(["mechanics"]);
    const donkey = { summary: "s", question: "Is a thing judged by what it can do now, or by what it will be able to do?" };
    expect(screenNote(donkey).flags).toEqual([]);
    const value = { summary: "s", question: "How much is a promise worth once the one who made it stops wanting it kept?" };
    expect(screenNote(value).flags).not.toContain("mechanics");
  });
  it("leaves the house style's own examples alone, apart from the low-weight if-why shape", () => {
    const hillel = { summary: "s", question: "Did Hillel keep his word to those men?" };
    expect(screenNote(hillel).flags).toEqual([]);
    const sea = { summary: "s", question: "If the majority was right to overrule the voice from Heaven, why does the sea rise against the man who enforced the ruling?" };
    expect(screenNote(sea).flags).toEqual(["contradiction"]);
    expect(screenNote(sea).score).toBe(1);
    const cheese = { summary: "s", question: "If it took cheeses carried to a war camp to establish that milk may be eaten, what were people doing with milk while the proof was still missing?" };
    expect(screenNote(cheese).flags).toEqual([]); // "if … what", not "if … why"
  });
  it("sees interpretation in the summary and unglossed terms in the question", () => {
    expect(screenNote({ summary: "Hillel seems to accept every condition and in effect refuses each one.", question: "q?" }).flags).toContain("interpretive");
    expect(screenNote({ summary: "The priest takes his portion.", question: "Why is teruma taken first?" }).flags).toContain("unglossed-question");
    expect(screenNote({ summary: "The priest takes his teruma, the priestly portion.", question: "Why is teruma taken first?" }).flags).not.toContain("unglossed-question");
  });
  it("labels for reports", () => {
    expect(screenLabel(screenNote({ summary: "s", question: "Why?" }))).toBe("clean");
    expect(screenLabel(screenNote(bekhorot3))).toMatch(/^reason-seeking(\+[a-z-]+)* \(\d+\)$/);
  });
});
