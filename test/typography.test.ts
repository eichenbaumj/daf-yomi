import { describe, expect, it } from "vitest";
import { SEFARIA_CLOSE, SEFARIA_OPEN, smartenHtml, smartenText } from "../src/render/typography";
import { renderDafPage } from "../src/render/dafPage";
import { checkNote, normalize } from "../src/note/grounding";

describe("typography", () => {
  it("curls apostrophes and quotes in prose", () => {
    expect(smartenText("Rav Mari's flock; the priests' portion; 'tis; \"a fence\" (\"yes\")")).toBe("Rav Mari’s flock; the priests’ portion; ‘tis; “a fence” (“yes”)");
    expect(smartenText("it's")).toBe("it’s");
    expect(smartenText("'90s and rock 'n' roll")).toBe("‘90s and rock ‘n’ roll"); // elisions open the wrong way; the shape does not occur in the notes
  });
  it("leaves tags, scripts, code and Sefaria's text alone, and folds the escaped marks", () => {
    const html = `<p title="don't">Rav's "word"</p><script>x = "s'"</script><code>'a'</code>${SEFARIA_OPEN}<b>Rav's</b>${SEFARIA_CLOSE}<p>Today&#39;s &quot;daf&quot;</p><b>Rav</b>'s`;
    expect(smartenHtml(html)).toBe(`<p title="don't">Rav’s “word”</p><script>x = "s'"</script><code>'a'</code>${SEFARIA_OPEN}<b>Rav's</b>${SEFARIA_CLOSE}<p>Today’s “daf”</p><b>Rav</b>’s`);
  });
  it("the gate reads a curly note the same as a straight one", () => {
    expect(normalize(smartenText(`Rav Mari's "ear"`))).toBe(normalize(`Rav Mari's "ear"`));
    const src = "Rav Mari sold the animal's ear to a gentile.";
    const note = { summary: "Rav Mari sold the animal's ear to a gentile and kept the rest, which is the whole story of the page in one line.", question: "Whose ear is it?", quotes: ["the animal's ear"] };
    expect(checkNote({ ...note, quotes: [smartenText(note.quotes[0]!)] }, src).ok).toBe(true);
  });
});
