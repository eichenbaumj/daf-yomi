import { describe, expect, it } from "vitest";
import { decodeEntities, plainText, sanitize } from "../src/sefaria/sanitize";

describe("sanitize", () => {
  it("keeps the Davidson markup and wraps the elucidation", () => {
    const html = `<strong>MISHNA:</strong> With regard to <b>one who purchases</b> the fetus <i>of</i> a donkey <b>and one who sells</b> it.`;
    const out = sanitize(html, { markElucidation: true });
    expect(out).toBe(`<strong>MISHNA:</strong><span class="elu"> With regard to </span><b>one who purchases</b><span class="elu"> the fetus <i>of</i> a donkey </span><b>and one who sells</b><span class="elu"> it.</span>`);
  });
  it("does not wrap when markElucidation is off, and unwraps <big>", () => {
    expect(sanitize(`מַתְנִי׳ <strong><big>הַלּוֹקֵחַ</big></strong> שֶׁל`)).toBe(`מַתְנִי׳ <strong>הַלּוֹקֵחַ</strong> שֶׁל`);
  });
  it("drops dangerous tags and attributes but keeps their text", () => {
    expect(sanitize(`<script>alert(1)</script><div onclick="x">hi</div> <b style="color:red" onmouseover="y">bold</b><img src=x onerror=z>`)).toBe(`alert(1)hi <b>bold</b>`);
  });
  it("vets hrefs", () => {
    expect(sanitize(`<a href="/Genesis.1.1">Gen</a>`)).toBe(`<a class="ref" href="https://www.sefaria.org/Genesis.1.1" rel="noopener">Gen</a>`);
    expect(sanitize(`<a href="https://www.sefaria.org/Exodus.13.13">Ex</a>`)).toContain(`href="https://www.sefaria.org/Exodus.13.13"`);
    expect(sanitize(`<a href="javascript:alert(1)">x</a>`)).toBe(`<a>x</a>`);
    expect(sanitize(`<a href="//evil.example/x">x</a>`)).toBe(`<a>x</a>`);
    expect(sanitize(`<a href="https://evil.example/x">x</a>`)).toBe(`<a>x</a>`);
  });
  it("drops Guggenheimer footnotes entirely", () => {
    const html = `Rebbi Abba said, explain it<sup class="footnote-marker">125</sup><i class="footnote">On the face of it, <b>the</b> equation…</i> as follows.`;
    expect(sanitize(html)).toBe(`Rebbi Abba said, explain it as follows.`);
  });
  it("turns it-text spans into italics and unwraps other spans", () => {
    expect(sanitize(`Tractate <span class="it-text">Bekhorot </span>deals <span class="x">with</span> law`)).toBe(`Tractate <i>Bekhorot </i>deals with law`);
  });
  it("escapes a stray <", () => {
    expect(sanitize(`a < b`)).toBe(`a &lt; b`);
  });
  it("tolerates unbalanced bold", () => {
    expect(sanitize(`</b>x<b>y`, { markElucidation: true })).toBe(`<span class="elu">x</span><b>y`);
  });
  it("makes plain text for prompts", () => {
    expect(plainText(`<strong>GEMARA:</strong> The Gemara asks: <b>Why do I</b> need &amp; want<sup class="footnote-marker">1</sup><i class="footnote">no</i>   this?`)).toBe(`GEMARA: The Gemara asks: Why do I need & want this?`);
    expect(decodeEntities("&#x27;&#39;&ldquo;x&rdquo;&nbsp;")).toBe(`''“x” `);
  });
});
