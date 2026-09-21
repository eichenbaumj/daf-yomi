import { describe, expect, it } from "vitest";
import { AI_LABEL, MJL_SERIES_URL, mjlUrl, renderDafPage, scholarLinks } from "../src/render/dafPage";
import { tractateBySlug } from "../src/daf/tractates";
import { esc } from "../src/render/layout";
import { renderAbout } from "../src/render/about";
import { SEDARIM } from "../src/render/dafYomiDiagram";
import { TRACTATES } from "../src/daf/tractates";
import { dafForDate } from "../src/daf/schedule";
import type { Env } from "../src/types";
import type { SefariaText } from "../src/sefaria/client";

const env = { SITE_NAME: "Today's Daf", SITE_TAGLINE: "tag", DEFAULT_TIMEZONE: "UTC", NOTE_MODEL: "claude-opus-5" } as unknown as Env;
const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y!, m! - 1, dd!); };
const text = (urlRef: string): SefariaText => ({
  urlRef, ref: urlRef.replace(".", " "), heRef: "בכורות ב׳ א",
  en: ["<strong>MISHNA:</strong> With regard to <b>one who purchases</b> a donkey.", "<b>Why do I</b> need all these?"],
  he: ["מַתְנִי׳ <strong><big>הַלּוֹקֵחַ</big></strong>", "כׇּל הָנֵי לְמָה לִי?"],
  enHtml: ['<strong>MISHNA:</strong><span class="elu"> With regard to </span><b>one who purchases</b><span class="elu"> a donkey.</span>', '<b>Why do I</b><span class="elu"> need all these?</span>'],
  heHtml: ["מַתְנִי׳ <strong>הַלּוֹקֵחַ</strong>", "כׇּל הָנֵי לְמָה לִי?"],
  enPlain: ["MISHNA: With regard to one who purchases a donkey.", "Why do I need all these?"],
  enVersion: { language: "en", versionTitle: "William Davidson Edition - English", license: "CC-BY-NC" },
  heVersion: { language: "he", versionTitle: "William Davidson Edition - Vocalized Aramaic", license: "CC-BY-NC" },
  next: null, prev: null, fetchedAt: "2026-09-20T00:00:00Z",
});

describe("site chrome", () => {
  const ref = dafForDate(d("2026-09-20"));
  it("shows the Newsletter tab right of Feed only once the newsletter is public", () => {
    const closed = renderAbout(env, "https://example.test", ref);
    expect(closed).not.toContain('href="/newsletter"');
    expect(closed).toContain("no tracking cookies");
    expect(closed).not.toContain("the daf by email");
    const open = renderAbout({ ...env, NEWSLETTER_PUBLIC: "1" } as Env, "https://example.test", ref);
    const nav = /<nav aria-label="Site">([\s\S]*?)<\/nav>/.exec(open)![1]!;
    const labels = [...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
    expect(labels).toEqual(["Today", "Tractates", "About", "Feed", "Newsletter"]);
    expect(open).toContain("keeps only your address and your chosen hour");
    expect(open).toMatch(/<a class="brand" [^>]*>.*Daf Yomi<span class="brand-tld">Dot Dev<\/span><\/a>/); // the wordmark
    expect(open).toContain('<a href="/newsletter">the daf by email</a> arrives once a day at the hour you choose.');
    expect(open).not.toMatch(/—/);
  });
});

describe("daf page", () => {
  const ref = dafForDate(d("2026-09-20"));
  const base = { env, origin: "https://example.test", ref, date: d("2026-09-20"), isToday: true, texts: [{ label: "Bekhorot 2a", text: text("Bekhorot.2a") }, { label: "Bekhorot 2b", text: text("Bekhorot.2b") }], notesEnabled: true };
  it("shows the AI label, attribution, position and toggles", () => {
    const html = renderDafPage({ ...base, note: { summary: "S.", question: "Q?", quotes: [], model: "m", promptVersion: "v", generatedAt: "t", sources: [] } });
    expect(html).toContain(esc(AI_LABEL));
    expect(html).toContain("William Davidson Talmud");
    expect(html).toContain("CC BY-NC 4.0");
    expect(html).toContain("Seder Kodashim");
    expect(html).toContain("Chapter 1 of 9");
    expect(html).toContain("Daf 2 of 61");
    expect(html).toContain("Day 2,451 of 2,711");
    expect((html.match(/class="dc/g) ?? []).length).toBe(60); // Bekhorot 2..61
    expect((html.match(/class="dc today"/g) ?? []).length).toBe(1);
    expect((html.match(/class="ms s\d cur"/g) ?? []).length).toBe(1);
    expect(html).toContain("Tractate 4 of 11"); // Bekhorot after Zevachim, Menachot, Chullin in Kodashim
    expect((html.match(/class="ms t s\d( cur)?"/g) ?? []).length).toBe(11);
    expect(html).toMatch(/>Kodashim<\/span>/);
    expect(html).toContain('data-regions=');
    expect(html).toMatch(/<div class="zoom-stage">[\s\S]*<p class="zoom-line">/); // bar first, its caption line beneath
    for (const hook of ['class="zcap"', 'class="zval"', 'class="zoom-hint"']) expect(html).toContain(hook); // app.js finds these by class
    expect(html).toContain('data-toggle="he"');
    expect(html).toContain('data-toggle="talmudOnly"');
    expect(html).toContain('data-toggle="text"'); // hide/show the daf, remembered across pages
    expect(html).toContain('<span class="elu">');
    expect(html).toContain('lang="he" dir="rtl"');
    expect(html).toContain('href="https://www.sefaria.org/Bekhorot.2a?lang=bi"');
    expect(html).toContain("9 Tishrei 5787");
    expect(html).toContain('<link rel="canonical" href="https://example.test/">'); // today's page is the homepage
    expect(html).toContain('<title>Today&#39;s Daf Yomi: Bekhorot 2 in English · Today&#39;s Daf</title>');
    expect(html).toContain('application/ld+json');
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]!);
    expect(ld.map((x: { "@type": string }) => x["@type"])).toEqual(["Article", "BreadcrumbList", "WebSite"]);
    expect(ld[1].itemListElement[3].item).toBe("https://example.test/bekhorot/2");
    expect(html).not.toMatch(/—/); // no em dashes in the chrome
  });
  it("gives a permalink its own canonical", () => {
    const html = renderDafPage({ ...base, isToday: false, note: null });
    expect(html).toContain('<link rel="canonical" href="https://example.test/bekhorot/2">');
    expect(html).toContain("<title>Bekhorot 2: Daf Yomi in English · Today&#39;s Daf</title>");
  });
  it("says when the note is pending instead of hiding the box", () => {
    const html = renderDafPage({ ...base, note: null });
    expect(html).toContain("has not been written yet");
    expect(html).toContain(esc(AI_LABEL));
  });
  it("links the four teaching sites in Go deeper, per daf where the site has a page", () => {
    const html = renderDafPage({ ...base, isToday: false, note: null }); // 2026-09-20 is in the past
    expect(html).toContain('<a href="https://hadran.org.il/daf/bekhorot-2/" rel="noopener">Hadran</a>');
    expect(html).toContain('<a href="https://www.myjewishlearning.com/article/bekhorot-2/" rel="noopener">My Jewish Learning</a> <span class="muted">(a short daily essay written for newcomers)</span>');
    expect(html).toContain('<a href="https://www.dafyomi.co.il/" rel="noopener">Kollel Iyun Hadaf</a>');
    expect(html).toContain('<a href="https://steinsaltz.org/todays-daf/" rel="noopener">Steinsaltz Center</a>');
    expect(html).toContain('rel="noopener">Sefaria</a>');
    expect(html.indexOf(">Hadran<")).toBeLessThan(html.indexOf(">My Jewish Learning<"));
  });
  it("sends a future daf, or an unverified tractate, to the My Jewish Learning series page instead of a 404", () => {
    const bekhorot = tractateBySlug("bekhorot")!;
    const niddah = tractateBySlug("niddah")!; // not reached in this cycle; no mjlSlug recorded
    expect(mjlUrl(bekhorot, 40, true)).toBe("https://www.myjewishlearning.com/article/bekhorot-40/");
    expect(mjlUrl(bekhorot, 40, false)).toBe(MJL_SERIES_URL);
    expect(mjlUrl(niddah, 2, true)).toBe(MJL_SERIES_URL);
    const future = renderDafPage({ ...base, isToday: false, date: new Date(Date.now() + 30 * 86400000), note: null });
    expect(future).toContain(`<a href="${MJL_SERIES_URL}" rel="noopener">My Jewish Learning</a>`);
    expect(scholarLinks(niddah, 2, undefined, "he")).toContain(`<a href="${MJL_SERIES_URL}" rel="noopener">My Jewish Learning</a> <span class="muted">(מסה יומית`);
    expect(scholarLinks(niddah, 2, undefined, "he")).toContain('href="https://hadran.org.il/he/daf/niddah-2/"');
  });
  it("records a verified Hadran slug for every tractate and a My Jewish Learning slug for every tractate the cycle has reached", () => {
    for (const t of TRACTATES) expect(t.hadranSlug, t.name).toBeTruthy();
    const reached = TRACTATES.filter((t) => t.order <= tractateBySlug("bekhorot")!.order);
    for (const t of reached) expect(t.mjlSlug, t.name).toBe(t.slug);
  });
  it("escapes note text", () => {
    const html = renderDafPage({ ...base, note: { summary: "<script>x</script>", question: "Q?", quotes: [], model: "m", promptVersion: "v", generatedAt: "t", sources: [] } });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});

describe("about", () => {
  it("has no em dashes or AI tells", () => {
    const html = renderAbout(env, "https://example.test", dafForDate(d("2026-09-20")));
    expect(html).not.toMatch(/—/);
    expect(html).not.toMatch(/\b(leverage|robust|seamless|holistic|delve)\b/i);
    expect(html).toContain("You are here: day 2,451, Bekhorot 2");
    expect((html.match(/class="dseg tractate/g) ?? []).length).toBe(40);
    expect((html.match(/class="dseg seder/g) ?? []).length).toBe(6);
    expect(html).not.toMatch(/\b0 tractates/);
  });
  it("places every tractate in one of the six Orders", () => {
    const names = new Set(SEDARIM.map((s) => s.name));
    for (const t of TRACTATES) expect(names.has(t.seder), `${t.name} → ${t.seder}`).toBe(true);
    const days = TRACTATES.reduce((a, t) => a + t.days, 0);
    expect(days).toBe(2711);
  });
});

describe("Hebrew pages (Pre-Release)", () => {
  const ref = dafForDate(d("2026-09-20"));
  const biur = (urlRef: string) => ({
    urlRef: `Steinsaltz_on_${urlRef}`, ref: `Steinsaltz on ${urlRef.replace(".", " ")}`, heRef: "ביאור שטיינזלץ על בכורות ב׳ א",
    html: ['<strong>א משנה</strong><span class="elu"> </span><b>הלוקח</b><span class="elu"> (הקונה) </span><b>עובר חמורו של נכרי</b>', '<strong>ב גמרא</strong><span class="elu"> ושואלים: </span><b>כל הני</b><span class="elu"> ששנינו </span><b>למה לי?</b>'],
    plain: ["א משנה הלוקח (הקונה) עובר חמורו של נכרי", "ב גמרא ושואלים: כל הני ששנינו למה לי?"],
    version: { language: "he" as const, versionTitle: "William Davidson Edition - Hebrew", license: "CC-BY-NC" },
    fetchedAt: "2026-09-20T00:00:00Z",
  });
  const note = { summary: "S.", question: "Q?", quotes: [], model: "m", promptVersion: "v", generatedAt: "2026-09-21T00:00:00Z", sources: [] };
  const tr = { summary: "המשנה מונה חמישה מקרים.", question: "למה חמישה?", quotes: [], of: note.generatedAt, sourcePromptVersion: "v", model: "m", promptVersion: "tv", generatedAt: "2026-09-21T01:00:00Z" };
  const base = { env, origin: "https://example.test", lang: "he" as const, ref, date: d("2026-09-20"), isToday: true, texts: [{ label: "Bekhorot 2a", text: text("Bekhorot.2a"), biur: biur("Bekhorot.2a") }, { label: "Bekhorot 2b", text: text("Bekhorot.2b"), biur: biur("Bekhorot.2b") }], notesEnabled: true };
  it("renders right to left with the biur as the text, noindex and the Pre-Release switch", () => {
    const html = renderDafPage({ ...base, note, translation: tr });
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('hreflang=');
    expect(html).toContain('<link rel="canonical" href="https://example.test/he">');
    expect(html).toContain('<nav class="lang" aria-label="שפה">');
    expect(html).toContain('<a lang="en" href="/lang/en?to=%2F">English</a>');
    expect(html).toContain('<span class="cur" lang="he" aria-current="true">עברית <span class="prerelease">Pre-Release</span></span>');
    expect(html).toContain('<p class="prerelease-notice">');
    expect(html).toContain('href="/"'); // the notice links the English page
    expect(html).toContain('<p class="en biur" lang="he"><strong>א משנה</strong><span class="elu">');
    expect(html).toContain('<p class="he" lang="he" dir="rtl">מַתְנִי׳'); // the original behind the toggle
    expect(html).toContain('data-toggle="he" data-off="הצגת המקור" data-on="הסתרת המקור"');
    expect(html).toContain('data-toggle="talmudOnly" data-off="גמרא בלבד"');
    expect(html).toContain("הדף של היום: בכורות ב׳");
    expect(html).toContain("<title>הדף היומי של היום: בכורות ב׳ · Today&#39;s Daf</title>");
    expect(html).toContain("ט׳ תשרי תשפ״ז");
    expect(html).toContain("יום ראשון, 20 בספטמבר 2026");
    expect(html).toContain("המשנה מונה חמישה מקרים."); // the translation, not the English note
    expect(html).not.toContain(">S.<");
    expect(html).toContain('href="/he/bekhorot/3"');
    expect(html).toContain('href="/he/tractates"');
    expect(html).toContain('<link rel="alternate" type="application/rss+xml" title="Today&#39;s Daf" href="/he/feed.xml">');
    expect(html).toContain("/og-he.png");
    expect(html).not.toContain('href="/newsletter"'); // no newsletter in Hebrew yet
    expect(html).not.toMatch(/—/);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]!);
    expect(ld[0].inLanguage).toBe("he");
    expect(ld[1].itemListElement[3].item).toBe("https://example.test/he/bekhorot/2");
  });
  it("says the note is not translated yet when the translation is missing or stale", () => {
    const missing = renderDafPage({ ...base, note, translation: null });
    expect(missing).toContain("טרם תורגמה לעברית");
    expect(missing).toContain('<a href="/bekhorot/2">');
    const stale = renderDafPage({ ...base, note, translation: { ...tr, of: "2026-09-01T00:00:00Z" } });
    expect(stale).toContain("טרם תורגמה לעברית");
    expect(stale).not.toContain("המשנה מונה");
  });
  it("shows the Mishnah alone when there is no biur", () => {
    const html = renderDafPage({ ...base, texts: [{ label: "Kinnim", text: text("Mishnah_Kinnim.1"), biur: null }], note: null, translation: null });
    expect(html).toContain("לימי המשנה אין ביאור שטיינזלץ");
    expect(html).not.toContain('data-toggle="he"');
    expect(html).toContain('<p class="en biur" lang="he">מַתְנִי׳');
  });
  it("indexes and offers alternates once HE_PUBLIC is set", () => {
    const html = renderDafPage({ ...base, env: { ...env, HE_PUBLIC: "1" } as Env, note, translation: tr, isToday: false });
    expect(html).not.toContain('name="robots"');
    expect(html).toContain('<link rel="alternate" hreflang="en" href="https://example.test/bekhorot/2">');
    expect(html).toContain('<link rel="alternate" hreflang="he" href="https://example.test/he/bekhorot/2">');
    expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://example.test/bekhorot/2">');
    expect(html).not.toContain("prerelease");
  });
  it("leaves the English page as it was, plus the switch", () => {
    const html = renderDafPage({ ...base, lang: "en", note, translation: null });
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).not.toContain('name="robots"');
    expect(html).toContain('<a lang="he" href="/lang/he?to=%2F">עברית <span class="prerelease">Pre-Release</span></a>');
    expect(html).toContain('data-toggle="he" data-off="Show Hebrew / Aramaic" data-on="Hide Hebrew / Aramaic"');
    expect(html).toContain(">S.<");
    expect(html).not.toContain("biur");
  });
  it("renders the Hebrew About and tractate pages without em dashes", () => {
    const about = renderAbout(env, "https://example.test", ref, "he");
    expect(about).toContain('<html lang="he" dir="rtl">');
    expect(about).toContain("אתם כאן: יום 2,451, בכורות ב׳");
    expect(about).not.toMatch(/—/);
    expect(about).toContain('href="https://www.myjewishlearning.com/article/daf-yomi/"');
    expect((about.match(/class="dseg tractate/g) ?? []).length).toBe(40);
  });
});
