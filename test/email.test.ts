import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aiLabel, attribution, firstSentence, heldBlock, legendSentence, personalize, renderConfirmEmail, renderIssue, subjectDate, PLACEHOLDERS, type IssueModel } from "../src/render/email";
import { AI_LABEL, LEGEND } from "../src/render/dafPage";
import { TRACTATES, tractateBySlug } from "../src/daf/tractates";
import { dafForDate, type DafRef } from "../src/daf/schedule";
import type { DafNote } from "../src/note/store";

const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y!, m! - 1, dd!); };
const note: DafNote = {
  summary: "Bekhorot opens with five ways a gentile can hold a stake in a donkey (purchase, sale, partnership, two kinds of receivership), and in all of them the offspring has no firstborn status. The Gemara then gets stuck on a side question: is a fetus, which cannot work, like a damaged animal that may be sold to a gentile, or like a healthy one, since it will grow up and work? At one point the whole reading of a baraita turns on whether a Hebrew word is masculine or feminine.",
  question: "Should something be judged by what it can do now, or by what it will be able to do later?",
  quotes: [], model: "m", promptVersion: "v", generatedAt: "2026-09-20T06:00:00.000Z", sources: [], wordCount: 3312,
};
const date = d("2026-09-20");
const base: IssueModel = { origin: "https://example.test", siteName: "Today's Daf", ref: dafForDate(date), date, note, hebrew: true };
const HEBREW = /[֐-׿]/;

describe("the daily issue", () => {
  const r = renderIssue(base);

  // The text part is wrapped at 72 columns, so long strings are compared with whitespace collapsed.
  const flat = r.text.replace(/\s+/g, " ");
  it("carries the AI label, the note and the question in both parts", () => {
    expect(r.html).toContain(aiLabel("email").replace(/'/g, "&#39;"));
    expect(flat).toContain(aiLabel("email"));
    expect(aiLabel("web")).toBe(AI_LABEL);
    expect(aiLabel("email")).toContain("linked below");
    expect(aiLabel("email")).not.toBe(AI_LABEL); // the site's label really says "on this page"; the email points at the link
    expect(r.html).toContain("no firstborn status");
    expect(flat).toContain(note.question);
    expect(r.html).toContain("https://example.test/bekhorot/2");
    expect(flat).toContain("Read Bekhorot 2 in English: https://example.test/bekhorot/2");
  });

  it("uses the subject and preheader conventions", () => {
    expect(r.subject).toBe("Bekhorot 2 · Sunday, 20 September");
    expect(subjectDate(d("2026-09-30"))).toBe("Wednesday, 30 September");
    expect(r.preheader).toBe("Bekhorot opens with five ways a gentile can hold a stake in a donkey (purchase, sale, partnership, two kinds of receivership), and in all of them the offspring has no firstborn status.");
    expect(firstSentence("One. Two.")).toBe("One.");
    expect(firstSentence("Did it? Yes.")).toBe("Did it?");
    for (const t of TRACTATES) {
      const s = renderIssue({ ...base, ref: { tractate: t, daf: t.lastDaf, cycle: 14, dayInCycle: 1 }, date: d("2026-09-30") });
      expect(s.subject.length, s.subject).toBeLessThan(45);
      expect(s.preheader.startsWith(`Last daf of ${t.name}. `)).toBe(true);
    }
    expect(r.subject).not.toMatch(/Joe|Eichenbaum/);
  });

  it("obeys the rendering contract", () => {
    expect(r.html.length).toBeLessThan(60_000);
    const styles = [...r.html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]!);
    expect(styles.length).toBe(2);
    expect(styles.reduce((a, s) => a + s.length, 0)).toBeLessThan(16_000);
    expect(styles[0]).not.toMatch(/\[|@import/); // block 1 is what Gmail keeps: no attribute selectors, no imports
    expect(r.html).not.toMatch(/—/);
    expect(r.text).not.toMatch(/—/);
    expect(r.html).not.toMatch(/var\(--/);
    expect(r.html).not.toMatch(/<script/i);
    expect(r.html).not.toMatch(/#ffffff|#000000/i);
    expect((r.html.match(/<table/g) ?? []).length).toBe((r.html.match(/role="presentation"/g) ?? []).length);
    expect((r.html.match(/<h1/g) ?? []).length).toBe(1);
    for (const a of r.html.match(/<a\s[^>]*>/g) ?? []) expect(a, a).toMatch(/style="[^"]*color:/);
    expect(r.html).toContain('<meta name="color-scheme" content="light only">');
    expect(r.html).toContain('id="body"');
    expect(r.html).toContain("&#10022;"); // the site's mark, as a character, never an image
    expect(r.html).not.toMatch(/<img/i);
    // Gold is decoration only: every element coloured gold is aria-hidden or a border.
    for (const m of r.html.matchAll(/<(span|td)[^>]*color:#a9812f[^>]*>/g)) expect(m[0], m[0]).toMatch(/aria-hidden="true"/);
  });

  it("keeps Hebrew to one isolated span, and can drop it", () => {
    const stripped = r.html.replace(/<span lang="he" dir="rtl"[^>]*>[^<]*<\/span>/g, "");
    expect(HEBREW.test(stripped)).toBe(false);
    expect(r.html).toMatch(/<span lang="he" dir="rtl"[^>]*unicode-bidi:isolate[^>]*>בכורות<\/span>/);
    const plain = renderIssue({ ...base, hebrew: false });
    expect(HEBREW.test(plain.html)).toBe(false);
    expect(HEBREW.test(plain.text)).toBe(false);
  });

  it("mirrors the HTML in the plain-text part", () => {
    for (const s of [note.summary.slice(0, 40), "William Davidson", "CC BY-NC 4.0", "https://example.test/newsletter/privacy", PLACEHOLDERS.unsub, PLACEHOLDERS.prefs, PLACEHOLDERS.email, "Free, no accounts, no tracking pixel."]) {
      expect(flat).toContain(s);
    }
    expect(flat).toContain("about 3,300 words");
    expect(r.html).toContain("about 3,300 words");
    expect(r.text.split("\n").filter((l) => !/^https?:\/\//.test(l.trim()) && !l.includes("http")).every((l) => l.length <= 80)).toBe(true);
  });

  it("glosses mishna, Gemara and baraita only when the note uses them", () => {
    expect(r.html).toContain("A mishna is the short ruling");
    expect(legendSentence()).toBe(LEGEND.replace(/<[^>]+>/g, "").slice(LEGEND.replace(/<[^>]+>/g, "").indexOf("A mishna")).trim());
    const quiet = renderIssue({ ...base, note: { ...note, summary: "A donkey and a fence.", question: "Which?" } });
    expect(quiet.html).not.toContain("A mishna is the short ruling");
  });

  it("names the day's place and glosses the Order", () => {
    expect(r.html).toContain("Bekhorot, one of the Talmud’s 40 tractates (books), daf 2 of 61.");
    expect(r.html).toContain("Seder Kodashim (holy things: the Temple and its offerings)");
    expect(r.html).toContain("Day 2,451 of 2,711");
    expect(r.html).toContain("Sunday, 20 September 2026");
    expect(r.html).toContain("9 Tishrei 5787");
  });

  it("renders the honest card when the note is missing", () => {
    const n = renderIssue({ ...base, note: null });
    expect(n.html).toContain("was not written in time");
    expect(n.text).toContain("was not written in time");
    expect(n.html).toContain(aiLabel("email").replace(/'/g, "&#39;"));
    expect(n.preheader).toContain("The page is ready");
  });

  it("credits the right text on the calendar-mode days", () => {
    const shekalim = tractateBySlug("shekalim")!;
    expect(attribution(shekalim).text).toContain("Guggenheimer");
    const s = renderIssue({ ...base, ref: { tractate: shekalim, daf: 2, cycle: 14, dayInCycle: 1 } });
    expect(s.html).toContain("Guggenheimer");
    expect(s.html).not.toContain("William Davidson");
    expect(s.html).toContain("https://www.sefaria.org/Jerusalem_Talmud_Shekalim");
    expect(attribution(tractateBySlug("kinnim")!).text).toContain("the Mishnah");
    expect(attribution(tractateBySlug("berakhot")!).text).toContain("William Davidson");
  });

  it("personalises without leaving placeholders", () => {
    const p = personalize(r, { unsubUrl: "https://example.test/newsletter/u/abc", prefsUrl: "https://example.test/newsletter/prefs/abc", email: "a&b@example.test", confirmedDate: "Sunday, 20 September 2026", heldHtml: "", heldText: "" });
    for (const ph of Object.values(PLACEHOLDERS)) { expect(p.html).not.toContain(ph); expect(p.text).not.toContain(ph); }
    expect(p.html).toContain("a&amp;b@example.test");
    expect(p.text).toContain("a&b@example.test");
    expect(p.html).toContain('href="https://example.test/newsletter/u/abc"');
    const held = heldBlock("https://example.test", [{ date: d("2026-09-26"), ref: dafForDate(d("2026-09-26")) }]);
    const q = personalize(r, { unsubUrl: "u", prefsUrl: "p", email: "e", confirmedDate: "c", heldHtml: held.html, heldText: held.text });
    expect(q.html).toContain("Held for Shabbat and Yom Tov");
    expect(q.html).toContain("Bekhorot 8");
    expect(q.text.replace(/\s+/g, " ")).toContain("Bekhorot 8 (Saturday, 26 September 2026) https://example.test/bekhorot/8");
  });

  it("never touches Sefaria at send time", () => {
    for (const f of ["src/render/email.ts", "src/newsletter/send.ts", "src/newsletter/plan.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/fetchText|sefaria\/client/);
    }
  });

  it("renders the confirmation email", () => {
    const c = renderConfirmEmail({ origin: "https://example.test", siteName: "Today's Daf", confirmUrl: "https://example.test/newsletter/confirm?t=x.y", hourLabel: "6 am", tz: "America/New_York", editionLabel: "the day's daf" });
    expect(c.subject).toBe("Confirm your Today’s Daf email");
    expect(c.html).toContain("Daf Yomi <span"); expect(c.html).toContain(">Dot Dev</span>"); expect(c.text).toContain("DAF YOMI DOT DEV"); // the wordmark, as on the site
    expect(c.html).toContain("https://example.test/newsletter/confirm?t=x.y");
    expect(c.text).toContain("Yes, send me the daf: https://example.test/newsletter/confirm?t=x.y");
    expect(c.html).not.toMatch(/<img/i);
    expect(c.html).not.toMatch(/—/);
  });
});

describe("dafForDate stays consistent with the fixture", () => {
  it("is Bekhorot 2 on 2026-09-20", () => {
    const ref: DafRef = dafForDate(date);
    expect(ref.tractate.slug).toBe("bekhorot");
    expect(ref.daf).toBe(2);
  });
});
