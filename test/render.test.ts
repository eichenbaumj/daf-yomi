import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AI_LABEL, MJL_SERIES_URL, clampSummary, mjlUrl, renderDafPage, scholarLinks } from "../src/render/dafPage";
import { MAP_AI_LABEL } from "../src/render/pageMap";
import type { DafMap } from "../src/map/store";
import { tractateBySlug } from "../src/daf/tractates";
import { esc } from "../src/render/layout";
import { renderAbout } from "../src/render/about";
import { renderNotFound } from "../src/render/simple";
import { renderTractatePage } from "../src/render/tractatePage";
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
  const base = { env, origin: "https://example.test", ref, date: d("2026-09-20"), isToday: true, atHome: true, texts: [{ label: "Bekhorot 2a", text: text("Bekhorot.2a") }, { label: "Bekhorot 2b", text: text("Bekhorot.2b") }], notesEnabled: true };
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
    expect(html).toContain(`data-regions='[[0,1],[`); // three levels: the six Orders open the bar, then this Order's tractates, then the dapim
    expect(JSON.parse(/data-regions='([^']+)'/.exec(html)![1]!)).toHaveLength(3);
    expect(html).toMatch(/<div class="zl on" data-l="0"><div class="geo"><span class="ms s1/); // the Orders are the opening layer
    expect(html).not.toContain('class="ms plain"');
    expect(html).toContain('<span class="zcap">The Talmud</span><span class="sep" aria-hidden="true">·</span><span class="zval">Day 2,451 of 2,711</span>');
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
    expect(html).toContain('<title>Today’s Daf Yomi: Bekhorot 2 in English · Today’s Daf</title>');
    expect(html).toContain('application/ld+json');
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]!);
    expect(ld.map((x: { "@type": string }) => x["@type"])).toEqual(["Article", "BreadcrumbList", "WebSite"]);
    expect(ld[1].itemListElement[3].item).toBe("https://example.test/bekhorot/2");
    expect(html).not.toMatch(/—/); // no em dashes in the chrome
  });
  it("points the social image at the daf's share card when one is stored for this note, else the static card", () => {
    const note = { summary: "S.", question: "Why five cases?", quotes: [], model: "m", promptVersion: "v", generatedAt: "t", sources: [] };
    const withCard = renderDafPage({ ...base, note, card: { token: "deadbeef" } });
    expect(withCard).toContain('<meta property="og:image" content="https://example.test/og/bekhorot/2/deadbeef.png">');
    expect(withCard).toContain('<meta name="twitter:image" content="https://example.test/og/bekhorot/2/deadbeef.png">');
    expect(withCard).toContain('<meta property="og:image:type" content="image/png">');
    expect(withCard).toContain('<meta property="og:image:alt" content="S.">'); // the card shows the note, so the alt is the note
    expect(withCard).toContain('<meta name="twitter:image:alt" content="S.">');
    expect(withCard).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(withCard).not.toContain("https://example.test/og.png\">"); // not as og:image
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(withCard)![1]!);
    expect(ld[0].image).toBe("https://example.test/og/bekhorot/2/deadbeef.png");
    expect(ld[0].publisher.logo.url).toBe("https://example.test/og.png"); // the logo stays the site's own card
    const noCard = renderDafPage({ ...base, note, card: null });
    expect(noCard).toContain('<meta property="og:image" content="https://example.test/og.png">');
    expect(noCard).toContain('<meta name="twitter:image" content="https://example.test/og.png">');
    expect(noCard).toContain('<meta property="og:image:alt" content="Today’s Daf: the day’s page of Talmud, in English">');
    const noNote = renderDafPage({ ...base, note: null, card: { token: "deadbeef" } }); // a stray token without a note never shows
    expect(noNote).toContain('<meta property="og:image" content="https://example.test/og.png">');
  });
  it("offers to share the note: the permalink and nothing else, never the homepage", () => {
    const note = { summary: "S.", question: "Why five cases?", quotes: [], model: "m", promptVersion: "v", generatedAt: "t", sources: [] };
    const html = renderDafPage({ ...base, note }); // isToday: canonical is "/", the share link must still be the permalink
    expect(html).toContain('<div class="note-actions"><button type="button" class="share" data-share-url="https://example.test/bekhorot/2" data-share-done="Copied" hidden>Share this note</button></div>');
    expect(html).not.toContain("data-share-line"); // no words travel with the link: the card says it all
    expect(html).not.toContain('class="toggle share"'); // a quiet text pillar, not a pill
    expect(html.indexOf('class="note-question"')).toBeLessThan(html.indexOf('class="note-actions"'));
    expect(html.indexOf('class="note-actions"')).toBeLessThan(html.indexOf("</aside>"));
    expect(html).not.toMatch(/—/);
    const pending = renderDafPage({ ...base, note: null });
    expect(pending).not.toContain("note-actions"); // nothing to share yet, and no newsletter in this env
  });
  it("gives a permalink its own canonical", () => {
    const html = renderDafPage({ ...base, isToday: false, atHome: false, note: null });
    expect(html).toContain('<link rel="canonical" href="https://example.test/bekhorot/2">');
    expect(html).toContain("<title>Bekhorot 2: Daf Yomi in English · Today’s Daf</title>");
  });
  it("keeps today's permalink canonical for itself; only the front page is canonical for /", () => {
    const perma = renderDafPage({ ...base, atHome: false, note: null }); // isToday, served at /bekhorot/2
    expect(perma).toContain('<link rel="canonical" href="https://example.test/bekhorot/2">');
    expect(perma).toContain('<meta property="og:url" content="https://example.test/bekhorot/2">');
    const ldP = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(perma)![1]!);
    expect(ldP.map((x: { "@type": string }) => x["@type"])).toEqual(["Article", "BreadcrumbList"]);
    const home = renderDafPage({ ...base, note: null });
    const ldH = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(home)![1]!);
    expect(ldH[0].url).toBe("https://example.test/bekhorot/2"); // the article lives at its permalink even on the front page
    expect(ldH[0].mainEntityOfPage).toEqual({ "@type": "WebPage", "@id": "https://example.test/bekhorot/2" });
    expect(ldH[2]["@type"]).toBe("WebSite");
    expect(ldH[2].alternateName).toContain("daf-yomi.dev");
  });
  it("keeps pages without a note out of the index until the note exists, except around today", () => {
    const today = d("2026-09-20");
    const far = renderDafPage({ ...base, isToday: false, atHome: false, date: d("2026-10-25"), todayDate: today, note: null });
    expect(far).toContain('<meta name="robots" content="noindex,follow">');
    const near = renderDafPage({ ...base, isToday: false, atHome: false, date: d("2026-09-22"), todayDate: today, note: null });
    expect(near).not.toContain('name="robots"');
    const todayNoNote = renderDafPage({ ...base, atHome: false, todayDate: today, note: null });
    expect(todayNoNote).not.toContain('name="robots"');
    const noted = renderDafPage({ ...base, isToday: false, atHome: false, date: d("2026-10-25"), todayDate: today, note: { summary: "S.", question: "Q?", quotes: [], model: "m", promptVersion: "v", generatedAt: "t", sources: [] } });
    expect(noted).not.toContain('name="robots"');
  });
  it("writes the snippet from the note, clamped at a sentence, with the label after", () => {
    const short = renderDafPage({ ...base, atHome: false, note: { summary: "A firstborn donkey belongs to the priest.", question: "Q?", quotes: [], model: "m", promptVersion: "v", generatedAt: "t", sources: [] } });
    expect(short).toContain('<meta name="description" content="A firstborn donkey belongs to the priest. Bekhorot 2, Daf Yomi in English.">');
    const long = "A firstborn male animal belongs to the priest and may not be sheared or put to work, but if a gentile owns a share of it, none of that applies. Rav Huna says owning the animal's ear is enough; Rav Nahman objects that the priest could simply tell the gentile to take his ear and go.";
    const html = renderDafPage({ ...base, atHome: false, note: { summary: long, question: "Q?", quotes: [], model: "m", promptVersion: "v", generatedAt: "t", sources: [] } });
    const desc = /<meta name="description" content="([^"]*)">/.exec(html)![1]!;
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(desc.startsWith("A firstborn male animal")).toBe(true);
    expect(desc).toContain(" Bekhorot 2, Daf Yomi in English.");
    expect(clampSummary(long)).toBe("A firstborn male animal belongs to the priest and may not be sheared or put to work, but if a gentile owns a share of it, none of that applies.".slice(0, 0) + clampSummary(long)); // stable
    expect(clampSummary("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone", 60)).toBe("one two three four five six seven eight nine ten eleven…");
    expect(clampSummary("Short. Then a very long second sentence that runs well past the limit we set here for this test.", 40)).toBe("Short.");
    const none = renderDafPage({ ...base, isToday: false, atHome: false, note: null });
    expect(none).toContain('<meta name="description" content="Bekhorot 2: the Daf Yomi page for Sunday, 20 September 2026, in English.">');
  });
  it("says when the note is pending instead of hiding the box", () => {
    const html = renderDafPage({ ...base, note: null });
    expect(html).toContain("has not been written yet");
    expect(html).toContain(esc(AI_LABEL));
  });
  it("puts the sign-up pillar inside the note once the newsletter is public, on English pages only, with the share pillar beside it", () => {
    const open = { ...env, NEWSLETTER_PUBLIC: "1", TURNSTILE_SITE_KEY: "0xKEY" } as Env;
    const html = renderDafPage({ ...base, env: open, note: { summary: "S.", question: "Q?", quotes: [], model: "m", promptVersion: "v", generatedAt: "t", sources: [] } });
    expect(html).toContain('<div class="note-actions"><details class="note-subscribe">\n  <summary><span class="note-subscribe-lead">Get the note as email</span></summary>');
    expect(html).not.toContain("note-subscribe\" open"); // folded by default
    expect(html.indexOf('class="note-question"')).toBeLessThan(html.indexOf('class="note-subscribe"'));
    expect(html.indexOf('class="note-subscribe"')).toBeLessThan(html.indexOf('class="share"')); // email left, share right
    expect(html.indexOf('class="share"')).toBeLessThan(html.indexOf("</aside>")); // both inside the note box
    expect(html.indexOf("</aside>")).toBeLessThan(html.indexOf('class="ornament"'));
    expect(html).toContain('<form method="post" action="/newsletter" novalidate>');
    expect(html).toContain('<input type="hidden" name="slot" value="morning">');
    expect(html).toContain('<input type="hidden" name="tz" value="UTC">');
    expect(html).toContain('name="consent" value="2026-09-v1"');
    expect(html).toContain('name="website" class="hp"');
    expect(html).toContain('<div class="cf-turnstile" data-sitekey="0xKEY"></div>');
    expect(html).toContain('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=dafTurnstileReady" async defer></script>');
    expect(html).toContain("appearance:'interaction-only'");
    expect(html.indexOf("</article>")).toBeLessThan(html.indexOf("details.note-subscribe")); // the script runs after the markup exists
    expect(html).toContain('<a href="/newsletter">The evening edition and other settings.</a>');
    expect(html).not.toMatch(/—/);
    const pending = renderDafPage({ ...base, env: open, note: null });
    expect(pending).toContain("Get the note as email"); // the email pillar alone: nothing to share yet
    expect(pending).not.toContain('class="share"');
    const closed = renderDafPage({ ...base, note: null });
    expect(closed).not.toContain("note-subscribe");
    expect(closed).not.toContain("challenges.cloudflare.com");
    const noKey = renderDafPage({ ...base, env: { ...env, NEWSLETTER_PUBLIC: "1" } as Env, note: null });
    expect(noKey).not.toContain("note-subscribe");
    const he = renderDafPage({ ...base, env: open, lang: "he", note: null, translation: null });
    expect(he).not.toContain("note-subscribe");
    expect(he).not.toContain('href="/newsletter"');
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
    const reviewed = renderDafPage({ ...base, note: { summary: "S.", question: "Q?", quotes: [], model: "m", promptVersion: "v", generatedAt: "t", sources: [], review: { at: "t", judgeVersion: "JUDGE-X", questionStatus: "open", reach: "idea", verdict: "keep", rewritten: false } } });
    expect(reviewed).not.toContain("JUDGE-X"); // the judge's record stays in KV
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});

describe("search-engine chrome", () => {
  const ref = dafForDate(d("2026-09-20"));
  it("writes the site's address on every page and describes About as an AboutPage by a Person", () => {
    const html = renderAbout(env, "https://example.test", ref);
    expect(html).toContain('<p class="muted small">daf-yomi.dev, one page a day since September 2026.</p>');
    expect(html).toContain("This site is daf-yomi.dev;");
    expect(html).toContain('<p class="powered"><a href="https://www.sefaria.org" rel="noopener"><svg class="sefaria-mark"');
    expect(html).toContain('</svg> Powered by Sefaria</a></p>');
    expect(html).not.toContain("powered-by-sefaria.png");
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]!);
    expect(ld["@type"]).toBe("AboutPage");
    expect(ld.author["@type"]).toBe("Person");
    expect(ld.author.sameAs).toContain("https://github.com/eichenbaumj");
    expect(ld.about.alternateName).toContain("daf-yomi.dev");
    const he = renderAbout(env, "https://example.test", ref, "he");
    expect(he).toContain("daf-yomi.dev, דף אחד ביום");
  });
  it("gives tractate pages a breadcrumb trail", () => {
    const t = tractateBySlug("bekhorot")!;
    const html = renderTractatePage({ env, origin: "https://example.test", tractate: t, today: ref, todayDate: d("2026-09-20"), noted: new Set([2]), intro: null });
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]!);
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement.map((x: { item: string }) => x.item)).toEqual(["https://example.test/", "https://example.test/tractates", "https://example.test/bekhorot"]);
    expect(html).toContain('<link rel="canonical" href="https://example.test/bekhorot">');
  });
  it("keeps the 404 page out of the index and gives it no canonical", () => {
    const html = renderNotFound(env, "https://example.test", "/nope");
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('property="og:url"');
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
  const base = { env, origin: "https://example.test", lang: "he" as const, ref, date: d("2026-09-20"), isToday: true, atHome: true, texts: [{ label: "Bekhorot 2a", text: text("Bekhorot.2a"), biur: biur("Bekhorot.2a") }, { label: "Bekhorot 2b", text: text("Bekhorot.2b"), biur: biur("Bekhorot.2b") }], notesEnabled: true };
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
    expect(html).toContain("<title>הדף היומי של היום: בכורות ב׳ · Today’s Daf</title>");
    expect(html).toContain("ט׳ תשרי תשפ״ז");
    expect(html).toContain("יום ראשון, 20 בספטמבר 2026");
    expect(html).toContain("המשנה מונה חמישה מקרים."); // the translation, not the English note
    expect(html).not.toContain(">S.<");
    expect(html).toContain('href="/he/bekhorot/3"');
    expect(html).toContain('href="/he/tractates"');
    expect(html).toContain('<link rel="alternate" type="application/rss+xml" title="Today’s Daf" href="/he/feed.xml">');
    expect(html).toContain('<meta property="og:image" content="https://example.test/og-he.png">'); // no Hebrew card yet: the static one
    expect(html).toContain('<div class="note-actions"><button type="button" class="share" data-share-url="https://example.test/he/bekhorot/2" data-share-done="הועתק" hidden>שיתוף ההערה</button></div>'); // the share pillar alone
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
    const html = renderDafPage({ ...base, env: { ...env, HE_PUBLIC: "1" } as Env, note, translation: tr, isToday: false, atHome: false });
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

describe("the map of the page", () => {
  const ref = dafForDate(d("2026-09-20"));
  const note = { summary: "S.", question: "Q?", quotes: [], model: "m", promptVersion: "v", generatedAt: "2026-09-21T00:00:00Z", sources: [] };
  const base = { env, origin: "https://example.test", ref, date: d("2026-09-20"), isToday: true, texts: [{ label: "Bekhorot 2a", text: text("Bekhorot.2a") }, { label: "Bekhorot 2b", text: text("Bekhorot.2b") }], notesEnabled: true, note };
  // The middle unit crosses from the a side to the b side on purpose.
  const map: DafMap = {
    units: [
      { from: "a-1", to: "a-1", kind: "mishna", title: "One who buys a donkey", gloss: "The case." },
      { from: "a-2", to: "b-1", kind: "question", title: "Rav's question", gloss: "Why list them all." },
      { from: "b-2", to: "b-2", kind: "open", title: "No answer comes", gloss: "It stands." },
    ],
    shape: "A mishna, a question, and it is left open.",
    generatedAt: "2026-09-21T00:00:00Z", promptVersion: "mv", model: "m", sources: ["Bekhorot.2a", "Bekhorot.2b"], segmentCounts: [2, 2],
  };
  it("draws the map between the note and the text, labelled AI, with markers in the text and the running head", () => {
    const html = renderDafPage({ ...base, map });
    const at = (needle: string) => { const i = html.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    expect(at("</aside>")).toBeLessThan(at('class="ornament"'));
    expect(at('class="ornament"')).toBeLessThan(at('class="pagemap"'));
    expect(at('class="pagemap"')).toBeLessThan(at('class="here-bar"'));
    expect(at('class="here-bar"')).toBeLessThan(at('class="tools"'));
    expect(at('class="tools"')).toBeLessThan(at('class="amud"'));
    // The AI label, once, above the map's words; the note keeps its own.
    expect(html.split(esc(MAP_AI_LABEL)).length - 1).toBe(1);
    expect(at(esc(MAP_AI_LABEL))).toBeLessThan(at(map.shape));
    expect(html).toContain(esc(AI_LABEL));
    expect(html).toContain('<span class="ai">AI map</span>');
    // Every segment carries its unit; the markers sit on the first segment of each unit.
    expect([...html.matchAll(/<li class="seg" id="([ab]-\d+)" data-unit="(\d+)">/g)].map((m) => `${m[1]}:${m[2]}`)).toEqual(["a-1:1", "a-2:2", "b-1:2", "b-2:3"]);
    expect(html).toMatch(/id="a-1" data-unit="1">\s*<div class="unit-mark"><a class="unit-mark-link" href="#pagemap-u1">/);
    expect(html).toMatch(/id="a-2" data-unit="2">\s*<div class="unit-mark"><a class="unit-mark-link" href="#pagemap-u2">/);
    expect(html).toMatch(/id="b-1" data-unit="2">\s*<a class="segno"/);
    expect(html).toMatch(/id="b-2" data-unit="3">\s*<div class="unit-mark"><a class="unit-mark-link" href="#pagemap-u3">/);
    expect((html.match(/class="unit-mark"/g) ?? []).length).toBe(3);
    // Every link resolves.
    const pagemap = /<nav class="pagemap"[\s\S]*?<\/nav>/.exec(html)![0];
    const unitLinks = [...pagemap.matchAll(/href="#([ab]-\d+)"/g)].map((m) => m[1]);
    expect(unitLinks).toEqual(["a-1", "a-2", "b-2"]);
    for (const id of unitLinks) expect(html).toContain(`id="${id}"`);
    for (const m of html.matchAll(/href="#pagemap-u(\d+)"/g)) expect(html).toContain(`id="pagemap-u${m[1]}"`);
    // The block is a table of contents: each gloss appears once, in its marker in the text, not in the block.
    const block = /<nav class="pagemap"[\s\S]*?<\/nav>/.exec(html)![0];
    for (const g of ["The case.", "Why list them all.", "It stands."]) { expect(html.split(g).length - 1, g).toBe(1); expect(block).not.toContain(g); }
    expect(html).toContain('<span class="unit-gloss">Why list them all.</span></div>');
    expect(html).not.toContain("pagemap-kinds");
    // Curly quotes reach the marker inside the fence and the running head's attribute; Sefaria's markup is untouched.
    expect(html).toContain('<span class="unit-title">Rav’s question</span>');
    expect(html).toContain('data-head="2 of 3 · A question: Rav’s question"');
    expect(html).toContain("<b>one who purchases</b>");
    expect(html).toContain("<b>Why do I</b>");
    // The running head: hidden until app.js fills it, page turns without rel (the bottom nav keeps the one pair).
    expect((html.match(/class="here-bar"/g) ?? []).length).toBe(1);
    expect(html).toContain('<nav class="here-bar" aria-label="Where you are on the page" hidden>');
    expect(html).toContain('<a class="here-text" href="#pagemap" title="Back to the shape of the page"></a>');
    expect(html).toMatch(/<a class="here-turn" href="\/bekhorot\/3" aria-label="Tomorrow: Bekhorot 3">→<\/a>/);
    expect((html.match(/class="here-turn"/g) ?? []).length).toBe(2);
    expect((html.match(/rel="prev"/g) ?? []).length).toBe(1);
    expect((html.match(/rel="next"/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/—/);
    // The existing exact counts are untouched by the map.
    expect((html.match(/class="dc/g) ?? []).length).toBe(60);
    // The map's own toggle, in its heading row, wired like the reading options; hiding it takes the markers and the bar too.
    expect((html.match(/data-toggle=/g) ?? []).length).toBe(4);
    expect(html).toContain('<div class="pagemap-head"><h2 id="pagemap-h" class="pagemap-h">The shape of the page</h2><button type="button" class="pagemap-toggle" data-toggle="map" data-off="Hide the map" data-on="Show the map" aria-pressed="false" aria-controls="pagemap-body">Hide the map</button></div>');
    expect(html).toContain('<div class="pagemap-body" id="pagemap-body">');
    expect(html).toContain('"daf:mapHidden")==="1"?" map-hidden"'); // restored before paint
  });
  it("draws nothing without a map, and nothing for a map that does not fit the text", () => {
    for (const html of [renderDafPage({ ...base }), renderDafPage({ ...base, map: { ...map, units: [map.units[0]!, { ...map.units[1]!, to: "a-2" }, { ...map.units[2]!, from: "b-1", to: "b-1" }] } })]) {
      expect(html).not.toContain('class="pagemap"');
      expect(html).not.toContain("here-bar");
      expect(html).not.toContain("data-unit=");
      expect(html).not.toContain("unit-mark");
    }
  });
  it("shows the Hebrew map on a Hebrew page, or nothing", () => {
    const biur = (urlRef: string) => ({ urlRef: `Steinsaltz_on_${urlRef}`, ref: "r", heRef: "h", html: ["<b>א</b>", "<b>ב</b>"], plain: ["א", "ב"], version: { language: "he" as const, versionTitle: "William Davidson Edition - Hebrew", license: "CC-BY-NC" }, fetchedAt: "2026-09-20T00:00:00Z" });
    const tr = { summary: "המשנה מונה חמישה מקרים.", question: "למה חמישה?", quotes: [], of: note.generatedAt, sourcePromptVersion: "v", model: "m", promptVersion: "tv", generatedAt: "2026-09-21T01:00:00Z" };
    const tmap = { shape: "משנה, שאלה, ונשאר פתוח.", units: [{ title: "הלוקח חמור", gloss: "המקרה." }, { title: "שאלת רב", gloss: "למה למנות." }, { title: "אין תשובה", gloss: "נשאר." }], of: map.generatedAt };
    const he = { ...base, lang: "he" as const, texts: [{ label: "Bekhorot 2a", text: text("Bekhorot.2a"), biur: biur("Bekhorot.2a") }, { label: "Bekhorot 2b", text: text("Bekhorot.2b"), biur: biur("Bekhorot.2b") }], translation: tr };
    const html = renderDafPage({ ...he, map, mapTranslation: tmap });
    expect(html).toContain("מבנה הדף");
    expect(html).toContain('<span class="ai">מפת AI</span>');
    expect(html).toContain(tmap.shape);
    for (const k of ["משנה", "שאלה", "נשאר פתוח"]) expect(html).toContain(`<span class="unit-kind">${k}</span>`);
    expect(html).toContain("הלוקח חמור");
    expect(html).not.toContain(map.shape);
    expect(html).not.toContain("A question");
    expect(html).not.toContain("The shape of the page");
    expect(html).toContain('data-head="2 מתוך 3 · שאלה: שאלת רב"');
    expect(html).toMatch(/<a class="here-turn" href="\/he\/bekhorot\/3" aria-label="מחר: בכורות ג׳">←<\/a>/);
    expect(html).not.toMatch(/—/);
    for (const missing of [renderDafPage({ ...he, map, mapTranslation: null }), renderDafPage({ ...he, map, mapTranslation: { ...tmap, of: "2026-09-01T00:00:00Z" } })]) {
      expect(missing).not.toContain('class="pagemap"');
      expect(missing).not.toContain("data-unit=");
    }
  });
  it("is wired in the stylesheet and the script", () => {
    const css = readFileSync("public/styles.css", "utf8");
    expect(css).toMatch(/html\.text-hidden \.pagemap \{ display: none; \}/);
    expect(css).toMatch(/html\.map-hidden \.pagemap-body, html\.map-hidden \.unit-mark, html\.map-hidden \.here-bar \{ display: none !important; \}/);
    expect(css).toMatch(/@media print \{[^}]*\.here-bar[^}]*display: none/);
    expect(css).toMatch(/prefers-reduced-motion[\s\S]{0,160}html \{ scroll-behavior: auto; \}/);
    expect(css).toMatch(/\.zoom-stage \{[^}]*height: 20px/); // the position bar, one step larger (Joe, 2026-09-22)
    const js = readFileSync("public/app.js", "utf8");
    for (const hook of ['getElementById("pagemap")', ".here-bar", "data-head", "IntersectionObserver", "aria-current", 'map: "daf:mapHidden"', 'map: "map-hidden"']) expect(js).toContain(hook);
  });
});
