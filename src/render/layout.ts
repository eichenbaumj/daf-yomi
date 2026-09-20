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
}

const FONTS = "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=Source+Sans+3:wght@400;600&family=Frank+Ruhl+Libre:wght@400;700&family=David+Libre:wght@400;700&display=swap";

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
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(siteName)}" href="/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/styles.css">
<script>try{var s=localStorage,q=new URLSearchParams(location.search),l=q.get("look");if(l){s.setItem("daf:look",l)}l=l||s.getItem("daf:look");if(l&&l!=="a"){document.documentElement.setAttribute("data-look",l)}document.documentElement.className+=(s.getItem("daf:he")==="1"?" show-he":"")+(s.getItem("daf:talmudOnly")==="1"?" talmud-only":"")}catch(e){}</script>
${o.extraHead ?? ""}
</head>
<body class="${esc(o.bodyClass ?? "")}">
<a class="skip" href="#main">Skip to the text</a>
<header class="site">
  <a class="brand" href="/">${esc(siteName)}</a>
  <nav aria-label="Site">
    <a href="/">Today</a>
    <a href="/tractates">Tractates</a>
    <a href="/about">About</a>
    <a href="/feed.xml" title="RSS feed">Feed</a>
  </nav>
</header>
<main id="main">
${o.body}
</main>
<footer class="site">
  <p>Text: <a href="https://www.sefaria.org/william-davidson-talmud" rel="noopener">The William Davidson Talmud</a> (Koren Noé edition, translation and commentary by Rabbi Adin Even-Israel Steinsaltz), via <a href="https://www.sefaria.org" rel="noopener">Sefaria</a>, <a href="https://creativecommons.org/licenses/by-nc/4.0/" rel="noopener">CC BY-NC 4.0</a>. Other texts credited on their pages.</p>
  <p>The daily note is written by an AI and says so. <a href="/about">How this works.</a> Free, no accounts, no tracking cookies.</p>
</footer>
<script src="/app.js" defer></script>
</body>
</html>`;
}
