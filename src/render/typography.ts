/**
 * Curly quotation marks and apostrophes for the site's own prose (Joe, 2026-09-22). Notes are stored with straight
 * marks (data stays ASCII; the grounding gate folds both), and the marks are made typographic at render time.
 *
 * Sefaria's text is never touched: it is fenced between SEFARIA_OPEN and SEFARIA_CLOSE by the renderers and the
 * HTML pass skips it, as it skips tags, scripts, styles, code and preformatted blocks. Hebrew chrome is left alone
 * too (a geresh is not an apostrophe); only English pages get the body pass. Chrome the renderers place inside
 * the fence (the map's unit markers, src/render/pageMap.ts) is curled by hand with smartenText before insertion.
 */
export const SEFARIA_OPEN = "<!--sefaria-->";
export const SEFARIA_CLOSE = "<!--/sefaria-->";

const APOS = "\u2019", LSQ = "\u2018", LDQ = "\u201C", RDQ = "\u201D";
const OPENER = /[\s(\[{\u2018\u201C\u00AB/-]/; // what comes before an opening quote

/** Plain text (no markup). `prev` is the character before this text when it is a fragment of something larger. */
export function smartenText(s: string, prev = ""): string {
  let out = "";
  let last = prev;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const next = s[i + 1] ?? "";
    if (c === "'") {
      const opening = (last === "" || OPENER.test(last)) && next !== "" && !/\s/.test(next);
      out += opening ? LSQ : APOS;
    } else if (c === '"') {
      const opening = (last === "" || OPENER.test(last)) && next !== "" && !/\s/.test(next);
      out += opening ? LDQ : RDQ;
    } else out += c;
    last = c;
  }
  return out;
}

const SKIP = /(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<pre\b[\s\S]*?<\/pre>|<code\b[\s\S]*?<\/code>|<textarea\b[\s\S]*?<\/textarea>|<!--sefaria-->[\s\S]*?<!--\/sefaria-->|<!--[\s\S]*?-->|<[^>]*>)/;

/** Rendered HTML (or XML): text nodes are smartened, everything else passes through untouched. Entities for the two
 *  marks that `esc()` produces are folded first, so escaped prose comes out curly as well. */
export function smartenHtml(html: string): string {
  const parts = html.split(SKIP);
  let last = "";
  return parts.map((part, i) => {
    // A block boundary starts fresh; an inline tag (<b>Rav</b>'s) does not, so the apostrophe after it still closes.
    if (i % 2 === 1) { if (/^<\/?(br|p|li|h\d|div|section|article|blockquote|td|th|tr|ul|ol|table|header|footer|aside|nav|main|body|head|title|meta|link|script|style|pre|code|textarea)\b/i.test(part) || part.startsWith("<!--")) last = ""; return part; }
    const text = part.replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"');
    const out = smartenText(text, last);
    if (out.length) last = out[out.length - 1]!;
    return out;
  }).join("");
}
