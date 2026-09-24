import { describe, expect, it } from "vitest";
import { parseSource } from "../src/newsletter/source";
import { foldSources } from "../src/newsletter/http";
import { fakeDb } from "./helpers/fakeDb";
import { renderNewsletterPage, renderPrivacyPage } from "../src/render/newsletterPages";
import type { Env } from "../src/types";

describe("campaign tag", () => {
  it("accepts a short lower-case word and nothing else", () => {
    expect(parseSource("ga-news-2026-09")).toBe("ga-news-2026-09");
    expect(parseSource("a")).toBe("a");
    expect(parseSource("a".repeat(32))).toBe("a".repeat(32));
    for (const bad of ["", "GA-news", "ga news", "ga_news", "a".repeat(33), "<b>", null, undefined]) expect(parseSource(bad)).toBeNull();
  });

  it("keeps the first source when a reader re-subscribes, and counts by tag", async () => {
    const db = fakeDb();
    const n = (email: string, source: string | null) => ({ email, email_hash: `h:${email}`, tz: "UTC", hour: 6, edition: "today" as const, hold_shabbat: 0 as const, consent_version: "t", unsub_token: email, source });
    await db.upsertConfirmed(n("a@x.test", "ga-news"), "2026-09-20T00:00:00.000Z");
    await db.upsertConfirmed(n("b@x.test", null), "2026-09-01T00:00:00.000Z");
    await db.upsertConfirmed(n("c@x.test", "ga-daf"), "2026-09-22T00:00:00.000Z");
    await db.unsubscribe("c@x.test", "2026-09-23T00:00:00.000Z");
    // Revival: an earlier tag stays, a later one fills a blank.
    await db.upsertConfirmed(n("a@x.test", "other"), "2026-09-23T00:00:00.000Z");
    await db.upsertConfirmed(n("b@x.test", "late"), "2026-09-23T00:00:00.000Z");
    expect(db.subscribers.find((s) => s.email === "a@x.test")!.source).toBe("ga-news");
    expect(db.subscribers.find((s) => s.email === "b@x.test")!.source).toBe("late");
    const folded = foldSources(await db.countBySource("2026-09-21T00:00:00.000Z", "2026-09-01T00:00:00.000Z"));
    expect(folded["ga-news"]).toEqual({ active: 1, unsubscribed: 0, confirmed7d: 1, confirmed30d: 1 });
    expect(folded["ga-daf"]).toEqual({ active: 0, unsubscribed: 1, confirmed7d: 1, confirmed30d: 1 });
    expect(folded["late"]).toEqual({ active: 1, unsubscribed: 0, confirmed7d: 1, confirmed30d: 1 });
    expect(folded["(none)"]).toBeUndefined();
  });
});

describe("the tag on the pages", () => {
  const env = { SITE_NAME: "Today's Daf", SITE_TAGLINE: "tag", DEFAULT_TIMEZONE: "UTC", NEWSLETTER_PUBLIC: "1" } as unknown as Env;
  it("rides as a hidden field on the full form and survives a validation re-render", () => {
    const blank = renderNewsletterPage(env, "https://daf-yomi.dev", { siteKey: "k", tzOptions: ["UTC"], defaultTz: "UTC" });
    expect(blank).toContain('<input type="hidden" name="src" value="">');
    expect(blank).toContain('sessionStorage.getItem("daf:src")');
    expect(blank).toContain('name="consent" value="2026-09-v2"');
    const again = renderNewsletterPage(env, "https://daf-yomi.dev", { siteKey: "k", tzOptions: ["UTC"], defaultTz: "UTC", state: { email: "x", src: "ga-news", error: "That does not look like an email address." } });
    expect(again).toContain('<input type="hidden" name="src" value="ga-news">');
    expect(again).not.toMatch(/—/);
  });
  it("is named on the privacy page, as the ad and not the reader", () => {
    const html = renderPrivacyPage(env, "https://daf-yomi.dev");
    expect(html).toContain("it names the ad, not you");
    expect(html).not.toMatch(/—/);
  });
});
