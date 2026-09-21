import type { Env } from "../types";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface PageOptions {
  env: Env;
  origin: string;
  title: string;
  description: string;
  /** Path for the canonical link, e.g. "/bekhorot/2". */
  canonicalPath: string;
  body: string;
  bodyClass?: string;
  extraHead?: string;
  ogType?: "website" | "article";
  /** Structured data objects, emitted as one JSON-LD script. */
  jsonLd?: unknown[];
}

const FONTS = "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=Frank+Ruhl+Libre:wght@400;700&display=swap";

export function page(o: PageOptions): string {
  const siteName = o.env.SITE_NAME;
  const fullTitle = o.title === siteName ? siteName : `${o.title} · ${siteName}`;
  const canonical = `${o.origin}${o.canonicalPath}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:site_name" content="${esc(siteName)}">
<meta property="og:type" content="${o.ogType ?? "website"}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(o.origin)}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(siteName)}: the day's page of Talmud, in English">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f3ead7">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(siteName)}" href="/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/styles.css">
<script>try{var s=localStorage;document.documentElement.className+=(s.getItem("daf:he")==="1"?" show-he":"")+(s.getItem("daf:talmudOnly")==="1"?" talmud-only":"")}catch(e){}</script>
${o.jsonLd && o.jsonLd.length ? `<script type="application/ld+json">${JSON.stringify(o.jsonLd.length === 1 ? o.jsonLd[0] : o.jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
${o.extraHead ?? ""}
</head>
<body class="${esc(o.bodyClass ?? "")}">
<a class="skip" href="#main">Skip to the text</a>
<header class="site">
  <a class="brand" href="/"><span class="brand-mark" aria-hidden="true">✦</span>${esc(siteName)}</a>
  <nav aria-label="Site">
    <a href="/">Today</a>
    <a href="/tractates">Tractates</a>
    <a href="/about">About</a>
    <a href="/feed.xml" title="RSS feed">Feed</a>${o.env.NEWSLETTER_PUBLIC === "1" ? `
    <a href="/newsletter">Newsletter</a>` : ""}
  </nav>
</header>
<main id="main">
${o.body}
</main>
<footer class="site">
  <p class="ornament" aria-hidden="true">✦ ✦ ✦</p>
  <p>The text is <a href="https://www.sefaria.org/william-davidson-talmud" rel="noopener">The William Davidson Talmud</a>: Rabbi Adin Even-Israel Steinsaltz's English translation and explanation (Koren Noé edition), served by <a href="https://www.sefaria.org" rel="noopener">Sefaria</a> under <a href="https://creativecommons.org/licenses/by-nc/4.0/" rel="noopener">CC BY-NC 4.0</a>. Other texts are credited where they appear.</p>
  <p>The daily note is written by an AI and says so. <a href="/about">How this works.</a> ${o.env.NEWSLETTER_PUBLIC === "1" ? "Free, no accounts, no tracking. The <a href=\"/newsletter\">daily email</a> keeps only your address and your chosen hour." : "Free, no accounts, no tracking cookies."} A good day of learning to you.</p>
</footer>
<script src="/app.js" defer></script>
</body>
</html>`;
}
