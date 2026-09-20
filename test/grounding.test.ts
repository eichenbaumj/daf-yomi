import { describe, expect, it } from "vitest";
import { articleSlips, checkNote, normalize, unglossed } from "../src/note/grounding";

const source = `MISHNA: With regard to one who purchases the fetus of a donkey that belongs to a gentile, and one who sells the fetus of his donkey to a gentile, the donkeys are exempt from the obligations of firstborn status. GEMARA: The Gemara asks: Why do I need all these examples in the mishna?`;

const good = {
  summary: "The mishna lists five ways a Jew and a gentile can share a donkey, and rules that in every one of them the firstborn owes nothing. The Gemara's first move is impatience: why five cases when one principle would do? The answer it builds is that each case closes a different loophole.",
  question: "If a single principle covers all five cases, what is lost by stating the principle and skipping the list?",
  quotes: ["Why do I need all these examples"],
};

describe("grounding", () => {
  it("passes a grounded note", () => {
    expect(checkNote(good, source)).toEqual({ ok: true, problems: [] });
  });
  it("rejects a quote that is not in the text", () => {
    const r = checkNote({ ...good, quotes: ["the donkey was very tired"] }, source);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/not found verbatim/);
  });
  it("rejects quoted prose that is not in the text", () => {
    const r = checkNote({ ...good, summary: good.summary + ' It calls this "a fence around the law of fences".' }, source);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.includes("quoted phrase not found"))).toBe(true);
  });
  it("is forgiving about curly quotes and case", () => {
    expect(normalize("“Why do I need” all")).toBe(`"why do i need" all`);
    expect(checkNote({ ...good, quotes: ["WHY DO I NEED ALL THESE EXAMPLES"] }, source).ok).toBe(true);
  });
  it("insists that untranslated terms are glossed", () => {
    expect(unglossed("if sending her away costs an issar and earns long days")).toEqual(["issar"]);
    expect(unglossed("costs an issar, a small copper coin, and earns")).toEqual([]);
    expect(unglossed("costs an issar (a small copper coin)")).toEqual([]);
    expect(unglossed("brings a sin offering called a chatat")).toEqual([]);
    expect(unglossed("the priests eat their teruma, the priestly portion")).toEqual([]);
    expect(unglossed("The Mishna lists thirty-six; the Gemara asks")).toEqual([]); // page vocabulary is glossed in the legend
    expect(unglossed("the harder mitzvot earn no less")).toEqual(["mitzvot"]);
    expect(unglossed("worth two hundred dinars, silver coins, at the time")).toEqual([]);
    expect(unglossed("paid in silver dinars and a copper issar")).toEqual([]);
    expect(unglossed("a measure of teruma set aside for the priests")).toEqual([]);
    expect(unglossed("two dinars of silver")).toEqual([]);
    expect(unglossed("he owed four dinars and left")).toEqual(["dinars"]);
    expect(unglossed("the harder mitzvot, the commandments that cost more, earn no less")).toEqual([]);
    expect(checkNote({ ...good, summary: "The mishna sets up an a fortiori argument. " + good.summary }, source).problems).toContainEqual(expect.stringMatching(/a fortiori/));
    expect(checkNote({ ...good, summary: good.summary + " It costs an issar." }, source).problems).toContainEqual(expect.stringMatching(/gloss "issar"/));
  });
  it("rejects a teaser-and-colon opener", () => {
    expect(checkNote({ ...good, summary: "Bekhorot opens with donkeys: " + good.summary }, source).problems).toContainEqual(expect.stringMatching(/teaser-and-colon/));
    expect(checkNote(good, source).ok).toBe(true); // a colon later in a full sentence is fine
  });
  it("catches article slips without false alarms", () => {
    expect(articleSlips("with a uprooted carob tree and an river")).toEqual(["a uprooted", "an river"]);
    expect(articleSlips("a one-time gift, a university, a useful hour, an honest man, an oven, a European")).toEqual([]);
    expect(checkNote({ ...good, summary: good.summary + " He waves a uprooted tree." }, source).problems).toContainEqual(expect.stringMatching(/article does not agree/));
  });
  it("rejects sermons, later authorities, em dashes, banned words, and bad shapes", () => {
    expect(checkNote({ ...good, summary: "This page teaches us patience. " + good.summary }, source).problems).toContainEqual(expect.stringMatching(/teaches us/));
    expect(checkNote({ ...good, summary: "Rashi explains that " + good.summary }, source).problems).toContainEqual(expect.stringMatching(/later authorities/));
    expect(checkNote({ ...good, summary: good.summary.replace(":", " —") }, source).problems).toContain("no em dashes.");
    expect(checkNote({ ...good, summary: good.summary + " A robust and nuanced tapestry." }, source).problems.length).toBeGreaterThanOrEqual(3);
    expect(checkNote({ ...good, question: "Is it? Or not?" }, source).problems).toContain("ask exactly one question.");
    expect(checkNote({ ...good, question: "No question here." }, source).problems).toContain("question must end with a question mark.");
    expect(checkNote({ ...good, summary: "In this daf, " + good.summary }, source).problems.some((p) => p.includes("In this daf"))).toBe(true);
  });
});
