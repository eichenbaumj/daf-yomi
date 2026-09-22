import { describe, expect, it } from "vitest";
import { TRANSLATE_PROMPT_VERSION, checkTranslation, ensureTranslation, hashTranslatePrompt, normalizeHe, translateUserMessage, translationCurrent, type TranslateDeps, type TranslationDraft } from "../src/note/translate";
import { hashTranslateJudgePrompt, type TranslationJudgment } from "../src/note/tjudge";
import { noteKey, type DafNote } from "../src/note/store";
import { currentTranslation, tnoteKey, type TranslatedNote } from "../src/note/tstore";
import { dafForDate } from "../src/daf/schedule";
import type { Env } from "../src/types";
import { FakeKV } from "./helpers/fakeKv";

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
  it("carries the 2026-09-22 guide ('re-say it, do not map it'), so every older translation is retired", () => {
    expect(hashTranslatePrompt("he")).toMatch(/^2026-09-22\.1-/);
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

describe("ensureTranslation", () => {
  const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y!, m! - 1, dd!); };
  const ref = dafForDate(d("2026-09-20")); // Bekhorot 2
  const englishNote: DafNote = { ...english, quotes: [], model: "m", promptVersion: "v", generatedAt: "2026-09-21T00:00:00Z", sources: [] };
  const usage = { inputTokens: 100, outputTokens: 10 };
  const bad: TranslationDraft = { ...good, summary: good.summary + " (Rashi)" }; // Latin letters: the gate rejects it
  const second: TranslationDraft = { ...good, question: "אם די במקרה אחד, למה המשנה מונה חמישה?" };
  const judgment = (over: Partial<TranslationJudgment> = {}): TranslationJudgment => ({ judgeVersion: hashTranslateJudgePrompt(), fidelity: [], language: [], sameQuestion: true, naturalness: 4, verdict: "keep", reasons: [], unverified: false, modelVerdict: "keep", feedback: "", ...over });
  const sentBack = judgment({ naturalness: 2, verdict: "rebake", reasons: ["language"], modelVerdict: "rebake", feedback: '"למה המשנה מונה חמישה" reads as a calque; say "למה מונה המשנה חמישה".' });

  function harness(drafts: TranslationDraft[], judgments: (TranslationJudgment | null)[] = [], judge?: TranslateDeps["judge"]) {
    const kv = new FakeKV();
    const env = { DAF_KV: kv as unknown as KVNamespace, ANTHROPIC_API_KEY: "k", NOTE_MODEL: "m", DAILY_GENERATION_CAP: "12" } as unknown as Env;
    const seen = { draftInputs: [] as string[], judgeCalls: 0, judgeSaw: [] as string[] };
    const deps: TranslateDeps = {
      buildInput: async () => ({ input: { lang: "he", label: "Bekhorot 2", note: { summary: english.summary, question: english.question, quotes: [] }, sections: [] }, heSource }),
      draft: async (input) => { seen.draftInputs.push(input.feedback ?? ""); return { draft: drafts.shift() ?? null, usage }; },
      judge: judge ?? (async (_label, _en, he) => { seen.judgeCalls++; seen.judgeSaw.push(he.question); return { judgment: judgments.shift() ?? null, usage }; }),
    };
    const stored = () => kv.get(tnoteKey("he", ref.tractate, ref.daf), "json") as Promise<TranslatedNote | null>;
    const seed = () => kv.put(noteKey(ref.tractate, ref.daf), JSON.stringify(englishNote));
    return { env, deps, seen, kv, stored, seed };
  }

  it("skips a daf with no English note", async () => {
    const h = harness([good]);
    expect(await ensureTranslation(h.env, ref, "he", {}, h.deps)).toEqual({ status: "skipped", reason: "no English note to translate" });
    expect(h.seen.draftInputs.length).toBe(0);
  });
  it("stores a draft that passes the gate, bound to the English note and the current style, with no judge and no review", async () => {
    const h = harness([good]); await h.seed();
    const out = await ensureTranslation(h.env, ref, "he", {}, h.deps);
    expect(out.status).toBe("generated");
    expect(h.seen.judgeCalls).toBe(0);
    const tr = await h.stored();
    expect(tr?.summary).toBe(good.summary);
    expect(tr?.of).toBe(englishNote.generatedAt);
    expect(tr?.promptVersion).toBe(hashTranslatePrompt("he"));
    expect(translationCurrent(englishNote, tr, "he")).toBe(true);
    expect(tr?.review).toBeUndefined();
    expect(tr?.usage).toMatchObject({ inputTokens: 100, outputTokens: 10, attempts: 1 });
    expect(await h.kv.get(`gen:${new Date().toISOString().slice(0, 10)}`)).toBe("1"); // counted against the daily cap
  });
  it("retries once with the gate's feedback and gives up after two rejected drafts", async () => {
    const h = harness([bad, good]); await h.seed();
    const out = await ensureTranslation(h.env, ref, "he", {}, h.deps);
    expect(out.status).toBe("generated");
    if (out.status !== "generated") return;
    expect(out.attempts).toBe(2);
    expect(out.firstAttemptProblems).toContain("Hebrew letters only in the prose; no Latin letters.");
    expect(h.seen.draftInputs[1]).toMatch(/Hebrew letters only/);
    const h2 = harness([bad, bad, good]); await h2.seed();
    const out2 = await ensureTranslation(h2.env, ref, "he", {}, h2.deps);
    expect(out2.status).toBe("failed");
    expect(await h2.stored()).toBeNull();
    expect(h2.seen.draftInputs.length).toBe(2);
  });
  it("with judge: once, a kept verdict is recorded on the translation", async () => {
    const h = harness([good], [judgment()]); await h.seed();
    const out = await ensureTranslation(h.env, ref, "he", { judge: "once" }, h.deps);
    expect(out.status).toBe("generated");
    if (out.status !== "generated") return;
    expect(out.judged?.verdict).toBe("keep");
    expect(h.seen.judgeCalls).toBe(1);
    expect(h.seen.judgeSaw).toEqual([good.question]);
    const tr = await h.stored();
    expect(tr?.review).toEqual({ at: tr?.generatedAt, judgeVersion: hashTranslateJudgePrompt(), naturalness: 4, verdict: "keep", reasons: [], rewritten: false });
    expect(tr?.usage?.inputTokens).toBe(200); // the judge's tokens count
  });
  it("with judge: once, a rebake verdict buys one more draft carrying the judge's feedback, and the judge runs exactly once", async () => {
    const h = harness([good, second], [sentBack, judgment()]); await h.seed();
    const out = await ensureTranslation(h.env, ref, "he", { judge: "once" }, h.deps);
    expect(out.status).toBe("generated");
    if (out.status !== "generated") return;
    expect(out.attempts).toBe(2);
    expect(h.seen.judgeCalls).toBe(1);
    expect(h.seen.draftInputs).toEqual(["", sentBack.feedback]);
    const tr = await h.stored();
    expect(tr?.question).toBe(second.question);
    expect(tr?.review).toMatchObject({ naturalness: 2, verdict: "rebake", reasons: ["language"], rewritten: true });
    expect(tr?.review?.unverified).toBeUndefined();
    expect(tr?.usage?.attempts).toBe(2);
  });
  it("judge: off never calls the judge", async () => {
    const h = harness([good], [sentBack]); await h.seed();
    const out = await ensureTranslation(h.env, ref, "he", { judge: "off" }, h.deps);
    expect(out.status).toBe("generated");
    expect(h.seen.judgeCalls).toBe(0);
    expect((await h.stored())?.review).toBeUndefined();
  });
  it("bounds the loop at three drafts: a gate rejection, the judged draft, the rewrite", async () => {
    const h = harness([bad, good, second], [sentBack]); await h.seed();
    const out = await ensureTranslation(h.env, ref, "he", { judge: "once" }, h.deps);
    expect(out.status).toBe("generated");
    if (out.status !== "generated") return;
    expect(out.attempts).toBe(3);
    expect(h.seen.judgeCalls).toBe(1);
    expect(h.seen.draftInputs[2]).toBe(sentBack.feedback);
    expect((await h.stored())?.review).toMatchObject({ verdict: "rebake", rewritten: true });
  });
  it("stores a draft the judge sent back when no draft is left, and its review says so", async () => {
    const h = harness([bad, bad, good], [sentBack]); await h.seed();
    const out = await ensureTranslation(h.env, ref, "he", { judge: "once" }, h.deps);
    expect(out.status).toBe("generated");
    if (out.status !== "generated") return;
    expect(out.attempts).toBe(3);
    expect((await h.stored())?.review).toMatchObject({ verdict: "rebake", rewritten: false });
  });
  it("records the judge's discounted span", async () => {
    const h = harness([good], [judgment({ unverified: true })]); await h.seed();
    await ensureTranslation(h.env, ref, "he", { judge: "once" }, h.deps);
    expect((await h.stored())?.review?.unverified).toBe(true);
  });
  it("a judge with no verdict, or one that throws, does not stop the translation", async () => {
    const h = harness([good], [null]); await h.seed();
    expect((await ensureTranslation(h.env, ref, "he", { judge: "once" }, h.deps)).status).toBe("generated");
    expect((await h.stored())?.review).toBeUndefined();
    const h2 = harness([good], [], async () => { throw new Error("naturalness: Too big"); }); await h2.seed();
    const out = await ensureTranslation(h2.env, ref, "he", { judge: "once" }, h2.deps);
    expect(out.status).toBe("generated");
    expect((await h2.stored())?.question).toBe(good.question);
    expect((await h2.stored())?.review).toBeUndefined();
  });
  it("respects the daily cap and the exists short-circuit", async () => {
    const h = harness([good]); await h.seed();
    await h.kv.put(`gen:${new Date().toISOString().slice(0, 10)}`, "12");
    expect((await ensureTranslation(h.env, ref, "he", {}, h.deps)).status).toBe("skipped");
    const h2 = harness([good]); await h2.seed();
    await h2.kv.put(tnoteKey("he", ref.tractate, ref.daf), JSON.stringify({ ...good, of: englishNote.generatedAt, sourcePromptVersion: "v", model: "m", promptVersion: hashTranslatePrompt("he"), generatedAt: "t" }));
    expect((await ensureTranslation(h2.env, ref, "he", {}, h2.deps)).status).toBe("exists");
    expect(h2.seen.draftInputs.length).toBe(0);
    await h2.kv.put(tnoteKey("he", ref.tractate, ref.daf), JSON.stringify({ ...good, of: englishNote.generatedAt, sourcePromptVersion: "v", model: "m", promptVersion: "old-style", generatedAt: "t" }));
    expect((await ensureTranslation(h2.env, ref, "he", {}, h2.deps)).status).toBe("generated"); // an old style is made again
  });
});
