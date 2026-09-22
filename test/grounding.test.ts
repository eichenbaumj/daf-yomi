import { describe, expect, it } from "vitest";
import { articleSlips, checkNote, danglingLegalVerbs, normalize, sagesNotOnPage, unglossed, unintroducedTerms } from "../src/note/grounding";

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
  it("keeps the question readable from the summary alone", () => {
    const stranger = { ...good, question: "What was Kontrokos relying on when he audited Moses?" };
    expect(checkNote(stranger, source).problems.some((p) => p.includes('"Kontrokos"'))).toBe(true);
    const idiom = { ...good, question: "If a single principle covers all five cases, what was the mishna standing on when it listed them?" };
    expect(checkNote(idiom, source).problems.some((p) => p.includes("no idioms"))).toBe(true);
    // Household names and words the summary already carries pass.
    const fine = { ...good, question: "If the Gemara accepts one principle for all five cases, why does the mishna spell out a list for the gentile?" };
    expect(checkNote(fine, source)).toEqual({ ok: true, problems: [] });
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
    expect(unglossed("in all of them the offspring has no firstborn status.")).toEqual(["firstborn status"]);
    expect(unglossed("no firstborn status, the rule that a firstborn male animal belongs to the priest, in any of them")).toEqual([]);
    expect(unglossed("exempts him from the priestly gifts of foreleg, jaw and stomach")).toEqual([]); // "of …" counts as a gloss
    expect(unglossed("exempts him from the priestly gifts entirely")).toEqual(["priestly gifts"]);
    expect(unglossed("exempts him from the priestly gifts (the foreleg, jaw and stomach owed to a priest)")).toEqual([]);
    expect(unglossed("brings a sin-offering, an animal offered for an unwitting sin,")).toEqual([]);
    // Real drafts my earlier check wrongly rejected:
    expect(unglossed("three boxes holding three seah each, a seah being a dry measure of several quarts")).toEqual([]);
    expect(unglossed("waves three hundred parasangs high, a parasang being roughly four kilometers")).toEqual([]);
    expect(unglossed("may eat a dinar's worth as he works, a coin six times the wage he was hired for")).toEqual([]);
    // Money context alone is not a gloss: "costs an issar" was the sentence Joe could not follow.
    expect(unglossed("until Rav Ashi hangs a pearl worth a thousand dinars on it")).toEqual(["dinars"]);
    expect(unglossed("sets payment for humiliation at two hundred dinars for a slap")).toEqual(["dinars"]);
    expect(unglossed("he walked ten parasangs before dawn and slept.")).toEqual(["parasangs"]);
    expect(unglossed("worth two hundred dinars, silver coins, at the time")).toEqual([]);
    expect(unglossed("paid in silver dinars and a copper issar")).toEqual([]);
    expect(unglossed("a measure of teruma set aside for the priests")).toEqual([]);
    expect(unglossed("two dinars of silver")).toEqual([]);
    expect(unglossed("he owed four dinars and left")).toEqual(["dinars"]);
    expect(unglossed("the harder mitzvot, the commandments that cost more, earn no less")).toEqual([]);
    expect(checkNote({ ...good, summary: "The mishna sets up an a fortiori argument. " + good.summary }, source).problems).toContainEqual(expect.stringMatching(/a fortiori/));
    expect(checkNote({ ...good, summary: good.summary + " It costs an issar." }, source).problems).toContainEqual(expect.stringMatching(/gloss "issar"/));
  });
  it("catches legal verbs with no object", () => {
    expect(danglingLegalVerbs("priests and Levites rendered Israelite firstborn sons and donkeys exempt in the wilderness")).toEqual(["exempt: exempt from what?"]);
    expect(danglingLegalVerbs("freed them from the laws of the firstborn; the owner is exempt from redeeming it")).toEqual([]);
    expect(danglingLegalVerbs("the offspring is exempt from firstborn status; he is liable to bring an offering")).toEqual([]);
    expect(danglingLegalVerbs("he is liable. She is obligated.")).toEqual(["liable: liable to or for what?", "obligated: obligated to do what?"]);
    expect(checkNote({ ...good, summary: good.summary + " The donkeys are exempt." }, source).problems).toContainEqual(expect.stringMatching(/legal verb left hanging/));
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

describe("the question is real, introduced, and about the people on the page", () => {
  const page = `${source} Rav Mari bar Raḥel sold the ears of his animals. Rabbi Yehuda HaNasi says the ear is enough. Rabbi Yoḥanan and Rabbi Akiva disagree. Abaye said: the Mishna speaks of an ordinary case. The Sages taught: teruma, the priests' portion, is separated first.`;
  it("rejects rhetorical openers, not emphasis or the prompt's own if-why shape", () => {
    expect(checkNote({ ...good, question: "Isn't it strange that the mishna lists five cases at all?" }, page).problems).toContainEqual(expect.stringMatching(/rhetorical/));
    expect(checkNote({ ...good, question: "Surely one principle would have done for all five cases?" }, page).problems).toContainEqual(expect.stringMatching(/rhetorical/));
    expect(checkNote({ ...good, question: "If a single principle covers all five cases, what did the list actually add?" }, page).ok).toBe(true); // "actually" is emphasis; the judge decides whether the page answers it
    // The sea example from the house style, and Joe's donkey question, pass.
    const sea = { ...good, summary: good.summary + " The majority overrules a voice from Heaven; the sea rises against the man who enforced the ruling.", question: "If the majority was right to overrule the voice from Heaven, why does the sea rise against the man who enforced the ruling?" };
    expect(checkNote(sea, page).ok).toBe(true);
    expect(checkNote({ ...good, question: "Is a thing judged by what it can do now, or by what it will be able to do?" }, page).ok).toBe(true);
    expect(checkNote({ ...good, question: "Is it enough that the gentile owns the ear, when the priest could tell him to take his ear and go?" }, page).ok).toBe(true);
  });
  it("wants glossary terms in the question introduced by the summary", () => {
    expect(unintroducedTerms("Why is teruma taken first?", "The priests eat their teruma, the priestly portion, before anything else.")).toEqual([]);
    expect(unintroducedTerms("Why is teruma taken first?", "The priests eat first.")).toEqual(["teruma"]);
    expect(unintroducedTerms("Do the harder mitzvot earn no less?", "A mitzva, a commandment, that costs an issar earns long life.")).toEqual([]); // stems: mitzvot after mitzva
    expect(unintroducedTerms("Is two hundred dinars a fair price?", "He set the price at a dinar, a silver coin.")).toEqual([]);
    expect(unintroducedTerms("Is two hundred zuz a fair price?", "He set the price at a dinar, a silver coin.")).toEqual(["zuz"]);
    expect(unintroducedTerms("Why does firstborn status follow the mother?", "The rule of firstborn status, that a firstborn male animal belongs to the priest, follows the mother.")).toEqual([]);
    expect(checkNote({ ...good, question: "If one principle covers all five cases, why does teruma come first?" }, page).problems).toContainEqual(expect.stringMatching(/"teruma", which the summary never introduced/));
  });
  it("wants every named sage on the page, in the page's own spelling or close to it", () => {
    expect(sagesNotOnPage("Rav Mari sold the ears; Rabbi Yehuda says the ear is enough; Rabbi Akiva's students; Rabbi Yohanan disagrees; Abaye objects.", page)).toEqual([]);
    expect(sagesNotOnPage("Rav Yosef sold the ears and Rava objected.", page)).toEqual(["Rav Yosef", "Rava"]);
    expect(sagesNotOnPage("Rabbi Meir and Rabbi Yehuda HaNasi", page)).toEqual(["Rabbi Meir"]);
    // Titles and transliterations vary between the note and the page; only an absent sage fails.
    expect(sagesNotOnPage("Rav Yehuda and Rabbi Yochanan and Rabbi Joḥanan and Rav Akiva", page)).toEqual([]);
    expect(sagesNotOnPage("Reish Lakish objects.", page + " Rabbi Shimon ben Lakish said so.")).toEqual([]);
    expect(sagesNotOnPage("Rav Yitzhak said.", page + " Rabbi Yitzḥak said.")).toEqual([]);
    expect(sagesNotOnPage("Rav Zeira said.", page + " Rabbi Zeira said.")).toEqual([]);
    expect(sagesNotOnPage("Rabba and Abaye disagree.", page + " Rabba said.")).toEqual([]); // the doubled letter folds on both sides
    expect(sagesNotOnPage("Rabba and Abaye disagree.", page)).toEqual(["Rabba"]);
    expect(sagesNotOnPage("The rabbi of the town, a rav, and Mar said nothing.", page)).toEqual([]); // titles alone are not names
    expect(checkNote({ ...good, summary: good.summary + " Rav Yosef objects." }, page).problems).toContainEqual(expect.stringMatching(/"Rav Yosef" is not named on this page/));
    expect(checkNote({ ...good, summary: good.summary + " Rav Mari bar Raḥel objects." }, page).ok).toBe(true);
  });
});
