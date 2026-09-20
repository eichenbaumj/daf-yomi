import { describe, expect, it } from "vitest";
import { AI_LABEL, renderDafPage } from "../src/render/dafPage";
import { esc } from "../src/render/layout";
import { renderAbout } from "../src/render/about";
import { dafForDate } from "../src/daf/schedule";
import type { Env } from "../src/types";
import type { SefariaText } from "../src/sefaria/client";

const env = { SITE_NAME: "Today's Daf", SITE_TAGLINE: "tag", DEFAULT_TIMEZONE: "UTC", NOTE_MODEL: "claude-opus-5" } as unknown as Env;
const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y!, m! - 1, dd!); };
const text = (urlRef: string): SefariaText => ({
  urlRef, ref: urlRef.replace(".", " "), heRef: "בכורות ב׳ א",
  en: ["<strong>MISHNA:</strong> With regard to <b>one who purchases</b> a donkey.", "<b>Why do I</b> need all these?"],
  he: ["מַתְנִי׳ <strong><big>הַלּוֹקֵחַ</big></strong>", "כׇּל הָנֵי לְמָה לִי?"],
  enVersion: { language: "en", versionTitle: "William Davidson Edition - English", license: "CC-BY-NC" },
  heVersion: { language: "he", versionTitle: "William Davidson Edition - Vocalized Aramaic", license: "CC-BY-NC" },
  next: null, prev: null, fetchedAt: "2026-09-20T00:00:00Z",
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
    expect(html).toContain('data-toggle="he"');
    expect(html).toContain('data-toggle="talmudOnly"');
    expect(html).toContain('<span class="elu">');
    expect(html).toContain('lang="he" dir="rtl"');
    expect(html).toContain('href="https://www.sefaria.org/Bekhorot.2a?lang=bi"');
    expect(html).toContain("9 Tishrei 5787");
    expect(html).toContain('<link rel="canonical" href="https://example.test/bekhorot/2">');
    expect(html).not.toMatch(/—/); // no em dashes in the chrome
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
    const html = renderAbout(env, "https://example.test");
    expect(html).not.toMatch(/—/);
    expect(html).not.toMatch(/\b(leverage|robust|seamless|holistic|delve)\b/i);
  });
});
