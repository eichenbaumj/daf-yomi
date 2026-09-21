import { describe, expect, it } from "vitest";
import { TRANSLATE_PROMPT_VERSION, checkTranslation, hashTranslatePrompt, normalizeHe, translateUserMessage, translationCurrent } from "../src/note/translate";
import type { DafNote } from "../src/note/store";
import type { TranslatedNote } from "../src/note/tstore";
import { currentTranslation } from "../src/note/tstore";

// Bekhorot 2a, first two segments of the vocalized Aramaic as Sefaria serves it, plus a Sefaria dash to prove it is stripped.
const heSource = [
  "מַתְנִי׳ הַלּוֹקֵחַ עוּבַּר חֲמוֹרוֹ שֶׁל נָכְרִי, וְהַמּוֹכֵר לוֹ, אַף עַל פִּי שֶׁאֵינוֹ רַשַּׁאי, הַמִּשְׁתַּתֵּף לוֹ, וְהַמְקַבֵּל הֵימֶנּוּ, וְהַנּוֹתֵן לוֹ בְּקַבָּלָה — פָּטוּר מִן הַבְּכוֹרָה, שֶׁנֶּאֱמַר: ״בְּיִשְׂרָאֵל״, אֲבָל לֹא בַּאֲחֵרִים.",
  "גְּמָ׳ כׇּל הָנֵי לְמָה לִי?",
].join("\n");
const english = { summary: "The mishna lists five ways a Jew and a gentile can share in a donkey's unborn firstborn, and rules all of them exempt from the firstborn obligation, because the verse says in Israel and not in others. The Gemara asks why five cases are needed when one would do.", question: "If one case would do, why does the mishna list five?" };
const good = {
  summary: "המשנה מונה חמש דרכים שבהן יהודי ונכרי שותפים בעובר חמורו, ופוסקת שכולן פטורות מן הבכורה, שכן הפסוק אומר \"בישראל\" ולא באחרים. הגמרא שואלת למה צריך חמישה מקרים כשאחד היה מספיק.",
  question: "אם מקרה אחד היה מספיק, למה המשנה מונה חמישה?",
  quotes: ["כל הני למה לי"],
};

describe("normalizeHe", () => {
  it("drops vowels, cantillation, maqaf and punctuation", () => {
    expect(normalizeHe("הַלּוֹקֵחַ עוּבַּר־חֲמוֹרוֹ, ״בְּיִשְׂרָאֵל״!")).toBe("הלוקח עובר חמורו בישראל");
    expect(normalizeHe("גְּמָ׳ כׇּל הָנֵי")).toBe("גמ כל הני");
  });
});

describe("checkTranslation", () => {
  it("passes a faithful translation whose quote is copied from the original", () => {
    expect(checkTranslation(good, heSource, english)).toEqual({ ok: true, problems: [] });
  });
  it("rejects a quote that is not in the original, even if it reads like Talmud", () => {
    const r = checkTranslation({ ...good, quotes: ["למה לי כל הני"] }, heSource, english);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/not found verbatim/);
  });
  it("rejects quoted spans in the prose that are not in the original", () => {
    const r = checkTranslation({ ...good, summary: good.summary.replace("שואלת", "שואלת \"למה צריך חמישה מקרים\" ו") }, heSource, english);
    expect(r.problems.some((p) => /quoted phrase not found/.test(p))).toBe(true);
  });
  it("rejects Latin letters, em dashes, a second question and later authorities", () => {
    expect(checkTranslation({ ...good, summary: good.summary + " (Rashi)" }, heSource, english).problems).toContain("Hebrew letters only in the prose; no Latin letters.");
    expect(checkTranslation({ ...good, summary: good.summary.replace(",", " —") }, heSource, english).problems).toContain("no em dashes.");
    expect(checkTranslation({ ...good, summary: good.summary + " למה?" }, heSource, english).problems).toContain("ask exactly one question.");
    expect(checkTranslation({ ...good, question: "מה אומר רש״י על כך?" }, heSource, english).problems).toContain("do not mention later authorities, Steinsaltz or Sefaria.");
    expect(checkTranslation({ ...good, question: "מה זה מלמד אותנו?" }, heSource, english).problems).toContain("no sermon: no 'teaches us', 'we learn', 'reminds us'.");
    expect(checkTranslation({ ...good, summary: "בדף זה " + good.summary }, heSource, english).problems).toContain("do not open with 'on this daf' or 'this page'.");
    expect(checkTranslation({ ...good, question: good.question.slice(0, -1) }, heSource, english).problems).toContain("question must end with a question mark.");
  });
  it("does not count a question mark inside a quotation from the daf", () => {
    const src = heSource + "\nאַטּוּ דַּרְכָּהּ שֶׁל מִלְחָמָה לִסְחוֹרָה?!";
    const r = checkTranslation({ ...good, summary: good.summary + " הגמרא דוחה: \"אַטּוּ דַּרְכָּהּ שֶׁל מִלְחָמָה לִסְחוֹרָה?!\"" }, src, english);
    expect(r.problems).not.toContain("ask exactly one question.");
    expect(r.ok).toBe(true);
  });
  it("rejects a summary that dropped most of the English", () => {
    const longEnglish = { ...english, summary: Array(12).fill("The Gemara asks about the donkey and the gentile partner.").join(" ") };
    const r = checkTranslation({ ...good, summary: "המשנה פוטרת מן הבכורה עובר חמורו של נכרי בחמישה מקרים שונים." }, heSource, longEnglish);
    expect(r.problems.some((p) => /much shorter/.test(p))).toBe(true);
  });
});

describe("the prompt", () => {
  it("shows the note and the aligned segments, and asks for Hebrew", () => {
    const msg = translateUserMessage({ lang: "he", label: "Bekhorot 2", note: { summary: "S.", question: "Q?", quotes: ["one who purchases"] }, sections: [{ label: "Bekhorot 2a", pairs: [{ n: 1, en: "MISHNA: one who purchases", he: "מתני׳ הלוקח" }] }] });
    expect(msg).toContain("SUMMARY: S.");
    expect(msg).toContain('QUOTES: "one who purchases"');
    expect(msg).toContain("[1]\nEN: MISHNA: one who purchases\nHE: מתני׳ הלוקח");
    expect(msg).toContain("Translate the note into Hebrew");
    expect(msg).not.toContain("rejected");
    expect(translateUserMessage({ lang: "he", label: "x", note: { summary: "", question: "", quotes: [] }, sections: [], feedback: "no em dashes." })).toContain("Your previous attempt was rejected: no em dashes.");
  });
  it("hashes the style guide under the version", () => {
    expect(hashTranslatePrompt("he")).toMatch(new RegExp(`^${TRANSLATE_PROMPT_VERSION.replace(".", "\\.")}-[0-9a-f]+$`));
    expect(() => hashTranslatePrompt("yi")).toThrow(/no translation style guide/);
  });
});

describe("binding a translation to its English note", () => {
  const note: DafNote = { summary: "S", question: "Q?", quotes: [], model: "m", promptVersion: "v", generatedAt: "2026-09-21T00:00:00Z", sources: [] };
  const tr: TranslatedNote = { summary: "ס", question: "ש?", quotes: [], of: note.generatedAt, sourcePromptVersion: "v", model: "m", promptVersion: hashTranslatePrompt("he"), generatedAt: "2026-09-21T01:00:00Z" };
  it("shows a translation only while the English note is the one it was made from", () => {
    expect(currentTranslation(note, tr)).toBe(tr);
    expect(currentTranslation({ ...note, generatedAt: "2026-09-22T00:00:00Z" }, tr)).toBeNull();
    expect(currentTranslation(null, tr)).toBeNull();
    expect(currentTranslation(note, null)).toBeNull();
  });
  it("re-translates when the style guide moved on", () => {
    expect(translationCurrent(note, tr, "he")).toBe(true);
    expect(translationCurrent(note, { ...tr, promptVersion: "old" }, "he")).toBe(false);
    expect(translationCurrent({ ...note, generatedAt: "later" }, tr, "he")).toBe(false);
  });
});
