import type { Env } from "../types";
import { ENABLED_LANGS, dirOf, p, type Lang } from "../i18n/strings";
import { strings } from "../i18n/format";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface PageOptions {
  env: Env;
  origin: string;
  /** Page language; English when absent. */
  lang?: Lang;
  title: string;
  description: string;
  /** Path for the canonical link, e.g. "/bekhorot/2". Language-neutral: the prefix is added here. */
  canonicalPath: string;
  body: string;
  bodyClass?: string;
  extraHead?: string;
  ogType?: "website" | "article";
  /** Structured data objects, emitted as one JSON-LD script. */
  jsonLd?: unknown[];
  /** No language switch, no alternates (newsletter and error pages). */
  noLangSwitch?: boolean;
  /** Absolute URL of a page-specific social image (the per-daf share card); the static card when absent. */
  ogImage?: string;
  ogImageAlt?: string;
}

const FONTS = "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=Frank+Ruhl+Libre:wght@400;700&display=swap";

/** Languages besides English are Pre-Release (noindex, no sitemap, no alternates) until their reviewer round is done. */
export function isPublicLang(env: Env, lang: Lang): boolean {
  return lang === "en" || (lang === "he" && env.HE_PUBLIC === "1");
}

export function page(o: PageOptions): string {
  const lang = o.lang ?? "en";
  const S = strings(lang);
  const siteName = o.env.SITE_NAME;
  const fullTitle = o.title === siteName ? siteName : `${o.title} · ${siteName}`;
  const canonical = `${o.origin}${p(lang, o.canonicalPath)}`;
  const prerelease = !isPublicLang(o.env, lang);
  const newsletterPublic = o.env.NEWSLETTER_PUBLIC === "1" && lang === "en";
  const ogImage = o.ogImage ?? `${o.origin}${lang === "he" ? "/og-he.png" : "/og.png"}`;
  const ogImageAlt = o.ogImageAlt ?? S.ogImageAlt(siteName);
  // Alternates only once every listed language is public, so search engines never see an unreviewed translation.
  const alternates = !o.noLangSwitch && ENABLED_LANGS.every((l) => isPublicLang(o.env, l))
    ? ENABLED_LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(o.origin)}${esc(p(l, o.canonicalPath))}">`).join("\n") + `\n<link rel="alternate" hreflang="x-default" href="${esc(o.origin)}${esc(o.canonicalPath)}">`
    : "";
  const langSwitch = o.noLangSwitch ? "" : `
  <nav class="lang" aria-label="${esc(S.langSwitchAria)}">${ENABLED_LANGS.map((l) => {
    const tag = isPublicLang(o.env, l) ? "" : ` <span class="prerelease">${esc(S.preReleaseTag)}</span>`;
    return l === lang
      ? `<span class="cur" lang="${l}" aria-current="true">${esc(S.langName[l])}${tag}</span>`
      : `<a lang="${l}" href="/lang/${l}?to=${encodeURIComponent(o.canonicalPath)}">${esc(S.langName[l])}${tag}</a>`;
  }).join('<span class="sep" aria-hidden="true">·</span>')}</nav>`;
  const notice = prerelease && !o.noLangSwitch ? `<p class="prerelease-notice">${S.preReleaseNotice(esc(o.canonicalPath))}</p>\n` : "";
  return `<!doctype html>
<html lang="${lang}" dir="${dirOf(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(o.description)}">
${prerelease ? '<meta name="robots" content="noindex">\n' : ""}<link rel="canonical" href="${esc(canonical)}">
${alternates ? alternates + "\n" : ""}<meta property="og:site_name" content="${esc(siteName)}">
<meta property="og:type" content="${o.ogType ?? "website"}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(ogImageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(ogImage)}">
<meta name="twitter:image:alt" content="${esc(ogImageAlt)}">
<meta name="theme-color" content="#f3ead7">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(siteName)}" href="${p(lang, "/feed.xml")}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/styles.css">
<script>try{var s=localStorage;document.documentElement.className+=(s.getItem("daf:he")==="1"?" show-he":"")+(s.getItem("daf:talmudOnly")==="1"?" talmud-only":"")+(s.getItem("daf:textHidden")==="1"?" text-hidden":"")}catch(e){}</script>
${o.jsonLd && o.jsonLd.length ? `<script type="application/ld+json">${JSON.stringify(o.jsonLd.length === 1 ? o.jsonLd[0] : o.jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
${o.extraHead ?? ""}
</head>
<body class="${esc(o.bodyClass ?? "")}">
<a class="skip" href="#main">${esc(S.skipToText)}</a>
<header class="site">
  <a class="brand" href="${p(lang, "/")}" aria-label="${esc(S.homeAria(siteName))}"><span class="brand-mark" aria-hidden="true">✦</span>Daf Yomi<span class="brand-tld">Dot Dev</span></a>
  <nav aria-label="Site">
    <a href="${p(lang, "/")}">${esc(S.navToday)}</a>
    <a href="${p(lang, "/tractates")}">${esc(S.navTractates)}</a>
    <a href="${p(lang, "/about")}">${esc(S.navAbout)}</a>
    <a href="${p(lang, "/feed.xml")}" title="${esc(S.navFeedTitle)}">${esc(S.navFeed)}</a>${newsletterPublic ? `
    <a href="/newsletter">${esc(S.navNewsletter)}</a>` : ""}
  </nav>${langSwitch}
</header>
${notice}<main id="main">
${o.body}
</main>
<footer class="site">
  <p class="ornament" aria-hidden="true">✦ ✦ ✦</p>
  <p>${S.footerAttribution}</p>
  <p>${S.footerNote(p(lang, "/about"), newsletterPublic, "/newsletter")}</p>
</footer>
<script src="/app.js" defer></script>
</body>
</html>`;
}
