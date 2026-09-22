import { describe, expect, it } from "vitest";
import { screenLabelHe, screenTranslation } from "../src/note/screenHe";

const q = "למה?";
const at = (summary: string, question = q) => screenTranslation({ summary, question });

describe("Hebrew screens", () => {
  it("hears the calques the native reader stumbled on (Bekhorot 4)", () => {
    for (const s of [
      "יש לפדותם מן הכהן.",
      "לוי צעיר מכדי להימנות אינו נמנה.",
      "רב ספרא מקשה על שתי הקריאות.",
      "יש כאן שתי קריאות של הפסוק הזה.",
      "הכהן בתור בעל הבכור פטור.",
      "מבחינת ההלכה הדין שונה.",
      "הדין כאן שונה לגמרי.",
    ]) expect(at(s).flags, s).toContain("calque");
    expect(at("הדין שונה", "האם הדין שונה לגמרי?").flags).toContain("calque");
  });
  it("leaves the guide's plain alternatives and ordinary Hebrew alone", () => {
    for (const s of [
      "פודים אותם אצל הכהן.",
      "החילופין האלה פטרו גם את בכורי הלוויים.",
      "לוי שעדיין לא נמנה אינו פוטר.",
      "רב ספרא מקשה על שני הפירושים.",
      "הכתוב פוטר גם אותם.",
      "לוי פחות מבן חודש לא בא תחת שום בכור.",
      "הדין שונה לגמרי אחר כך.",
      "הוא עסק בתורה כל היום.",
      "קריאת שמע של ערבית.",
    ]) expect(at(s).flags, s).toEqual([]);
  });
  it("flags a bare verse but not one with its article or a prefix", () => {
    expect(at("פסוק פוטר גם אותם.").flags).toContain("bare-verse");
    expect(at("נאמר: פסוק אחד לכל.").flags).toContain("bare-verse");
    for (const s of ["הפסוק פוטר גם אותם.", "בפסוק נאמר כך.", "שהפסוק אומר.", "הכתוב פוטר גם אותם.", "שני פסוקים נאמרו."]) expect(at(s).flags, s).not.toContain("bare-verse");
  });
  it("flags a sentence of more than 28 words, not two sentences of 28", () => {
    const long = Array(29).fill("מילה").join(" ") + ".";
    expect(at(long).flags).toContain("long-sentence");
    const two = Array(28).fill("מילה").join(" ") + ". " + Array(28).fill("מילה").join(" ") + ".";
    expect(at(two).flags).not.toContain("long-sentence");
    const question = Array(29).fill("מילה").join(" ") + "?";
    expect(at("קצר.", question).flags).toContain("long-sentence");
  });
  it("hears a question that opens with the summary's first four words", () => {
    const summary = "המשנה מונה חמש דרכים שבהן יהודי ונכרי שותפים בעובר חמורו.";
    expect(at(summary, "המשנה מונה חמש דרכים, אבל למה?").flags).toContain("echo-question");
    expect(at(summary, "למה המשנה מונה חמש דרכים?").flags).not.toContain("echo-question");
    expect(at("קצר מאוד.", "קצר מאוד?").flags).not.toContain("echo-question");
  });
  it("weighs and labels", () => {
    expect(screenLabelHe(at("הכתוב פוטר גם אותם."))).toBe("clean");
    const s = at("פסוק פוטר אותם מן הכהן.");
    expect(s.flags).toEqual(["calque", "bare-verse"]);
    expect(s.score).toBe(4);
    expect(screenLabelHe(s)).toBe("calque+bare-verse (4)");
  });
});
