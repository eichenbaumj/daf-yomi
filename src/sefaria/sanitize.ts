/**
 * Sefaria delivers each segment as a small HTML string. We keep a short
 * allowlist of inline tags, drop every attribute except a vetted href, and,
 * for the English, wrap the runs of text that are NOT bold in
 * <span class="elu"> so the "Talmud only" toggle can hide them.
 *
 * In the William Davidson edition, bold is the translation of the Talmud's
 * own words and regular weight is Rabbi Steinsaltz's interpolated
 * explanation. <strong> carries the MISHNA:/GEMARA: labels.
 */

const KEEP_BARE = new Set(["b", "strong", "i", "em", "sup", "sub"]);
const BOLD = new Set(["b", "strong"]);

interface Tag { name: string; closing: boolean; attrs: string }

function parseTag(tok: string): Tag | null {
  const m = /^<(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*?)\/?>$/.exec(tok);
  if (!m) return null;
  return { name: m[2]!.toLowerCase(), closing: m[1] === "/", attrs: m[3] ?? "" };
}
function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
}
function classList(attrs: string): string[] {
  return (attr(attrs, "class") ?? "").split(/\s+/).filter(Boolean);
}
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^https?:\/\/(www\.)?sefaria\.org\//i.test(href)) return href;
  if (href.startsWith("/") && !href.startsWith("//")) return `https://www.sefaria.org${href}`;
  return null;
}

export interface SanitizeOptions {
  /** Wrap non-bold runs in <span class="elu">. English Talmud only. */
  markElucidation?: boolean;
}

export function sanitize(html: string, opts: SanitizeOptions = {}): string {
  const tokens = String(html).match(/<[^>]*>|<|[^<]+/g) ?? [];
  const out: string[] = [];
  let boldDepth = 0;
  let skipDepth = 0; // > 0 while inside a footnote we are dropping
  let skipTag = "";
  const spanStack: ("i" | "unwrap")[] = [];
  let run: string[] = []; // pending elucidation run (markElucidation && boldDepth === 0)

  const flushRun = () => {
    if (run.length === 0) return;
    const s = run.join("");
    out.push(/\S/.test(s.replace(/<[^>]*>/g, "")) ? `<span class="elu">${s}</span>` : s);
    run = [];
  };
  const emit = (s: string) => {
    if (opts.markElucidation && boldDepth === 0) run.push(s);
    else out.push(s);
  };

  for (const tok of tokens) {
    if (tok === "<") { if (!skipDepth) emit("&lt;"); continue; }
    if (!tok.startsWith("<")) { if (!skipDepth) emit(tok); continue; }
    const tag = parseTag(tok);
    if (!tag) continue; // malformed: drop
    const { name, closing } = tag;

    if (skipDepth) {
      if (name === skipTag) skipDepth += closing ? -1 : 1;
      continue;
    }
    const classes = classList(tag.attrs);
    // Footnotes (Guggenheimer's Yerushalmi): drop the marker and the body.
    if (!closing && ((name === "sup" && classes.includes("footnote-marker")) || (name === "i" && classes.includes("footnote")))) {
      skipDepth = 1; skipTag = name; continue;
    }
    if (name === "br") { emit("<br>"); continue; }
    if (name === "a") {
      if (closing) { emit("</a>"); continue; }
      const href = safeHref(attr(tag.attrs, "href") ?? "");
      emit(href ? `<a class="ref" href="${href}" rel="noopener">` : "<a>");
      continue;
    }
    if (name === "span") {
      if (closing) { if (spanStack.pop() === "i") emit("</i>"); continue; }
      if (classes.includes("it-text")) { spanStack.push("i"); emit("<i>"); }
      else spanStack.push("unwrap");
      continue;
    }
    if (!KEEP_BARE.has(name)) continue; // anything else (big, small, div, p, img, script…): unwrap
    if (BOLD.has(name)) {
      if (!closing) { flushRun(); boldDepth++; out.push(`<${name}>`); }
      else if (boldDepth > 0) { boldDepth--; out.push(`</${name}>`); }
      continue;
    }
    emit(closing ? `</${name}>` : `<${name}>`);
  }
  flushRun();
  return out.join("");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", thinsp: " ", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…", mdash: "—", ndash: "–" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code: string) => {
    if (/^#x/i.test(code)) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code] ?? m;
  });
}

/** Plain text for prompts and grounding checks: tags gone, footnotes gone, entities decoded, whitespace collapsed. */
export function plainText(html: string): string {
  const stripped = sanitize(html).replace(/<br>/g, " ").replace(/<[^>]*>/g, "");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}
