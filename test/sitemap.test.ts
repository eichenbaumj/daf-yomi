import { describe, expect, it } from "vitest";
import { renderSitemap, loadNoted } from "../src/render/sitemap";
import { FakeKV } from "./helpers/fakeKv";
import { TRACTATES, tractateBySlug } from "../src/daf/tractates";
import { dafForDate } from "../src/daf/schedule";
import { putNote, notedDafimWithDates } from "../src/note/store";
import type { Env } from "../src/types";

const env = { SITE_NAME: "Today's Daf" } as unknown as Env;
const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y!, m! - 1, dd!); };
const note = (generatedAt: string) => ({ summary: "S.", question: "Q?", quotes: [], model: "m", promptVersion: "v", generatedAt, sources: [] });

describe("sitemap", () => {
  const today = d("2026-09-20"); // Bekhorot 2
  const todayRef = dafForDate(today);
  const bekhorot = tractateBySlug("bekhorot")!;
  const niddah = tractateBySlug("niddah")!;

  it("lists the pages, every tractate, and only dafim that have a note or are today, with lastmod where known", async () => {
    const kv = new FakeKV();
    await putNote(kv as unknown as KVNamespace, bekhorot, 3, note("2026-09-19T06:00:00.000Z"));
    await putNote(kv as unknown as KVNamespace, bekhorot, 5, note("2026-09-21T06:00:00.000Z"));
    kv.store.set("note:v1:berakhot:2", { value: JSON.stringify(note("2026-01-01T00:00:00.000Z")) }); // an old note without metadata
    const noted = await loadNoted(kv as unknown as KVNamespace);
    const xml = renderSitemap({ origin: "https://example.test", env, today, todayRef, noted });
    expect(xml).toContain("<url><loc>https://example.test/</loc><lastmod>2026-09-20</lastmod></url>");
    expect(xml).toContain("<url><loc>https://example.test/about</loc></url>");
    expect(xml).toContain("<url><loc>https://example.test/tractates</loc></url>");
    expect(xml).toContain("<url><loc>https://example.test/newsletter</loc></url>");
    for (const t of TRACTATES) expect(xml).toContain(`<loc>https://example.test/${t.slug}</loc>`);
    expect(xml).toContain("<url><loc>https://example.test/bekhorot/2</loc></url>"); // today, no note yet, no lastmod
    expect(xml).toContain("<url><loc>https://example.test/bekhorot/3</loc><lastmod>2026-09-19T06:00:00.000Z</lastmod></url>");
    expect(xml).toContain("<url><loc>https://example.test/bekhorot/5</loc><lastmod>2026-09-21T06:00:00.000Z</lastmod></url>");
    expect(xml).toContain("<url><loc>https://example.test/bekhorot</loc><lastmod>2026-09-21T06:00:00.000Z</lastmod></url>"); // the newest of its dafim
    expect(xml).toContain("<url><loc>https://example.test/berakhot/2</loc></url>"); // noted, but no metadata yet: no guessed lastmod
    expect(xml).toContain("<url><loc>https://example.test/berakhot</loc></url>");
    expect(xml).not.toContain("/bekhorot/4</loc>"); // no note, not today: noindex, so unlisted
    expect(xml).not.toContain("/niddah/70</loc>");
    expect(xml).toContain(`<loc>https://example.test/${niddah.slug}</loc>`); // the tractate page itself is always listed
    expect(xml).not.toContain("/he/");
    expect((xml.match(/<url>/g) ?? []).length).toBe(3 + TRACTATES.length + 4 + 1);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset ')).toBe(true);
  });
  it("escapes ampersands in URLs", () => {
    const xml = renderSitemap({ origin: "https://a.test?x=1&y=2", env, today, todayRef, noted: new Map() });
    expect(xml).toContain("https://a.test?x=1&amp;y=2/about");
    expect(xml).not.toMatch(/&(?!amp;)/);
  });
  it("adds Hebrew URLs and alternates once Hebrew is public", () => {
    const xml = renderSitemap({ origin: "https://example.test", env: { ...env, HE_PUBLIC: "1" } as Env, today, todayRef, noted: new Map() });
    expect(xml).toContain("<loc>https://example.test/he/about</loc>");
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="he" href="https://example.test/he/about"/>');
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="x-default" href="https://example.test/about"/>');
  });
  it("putNote stamps generatedAt as metadata and notedDafimWithDates reads it back", async () => {
    const kv = new FakeKV();
    await putNote(kv as unknown as KVNamespace, bekhorot, 9, note("2026-09-22T06:00:00.000Z"));
    kv.store.set("note:v1:bekhorot:10", { value: "{}" });
    kv.store.set("note:v1:bekhorotx:1", { value: "{}" }); // another prefix must not leak in
    const m = await notedDafimWithDates(kv as unknown as KVNamespace, bekhorot);
    expect([...m.entries()]).toEqual([[9, "2026-09-22T06:00:00.000Z"], [10, null]]);
  });
});
