import { describe, expect, it } from "vitest";
import { AI_LABEL, renderDafPage } from "../src/render/dafPage";
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
