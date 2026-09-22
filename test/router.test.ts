import { describe, expect, it } from "vitest";
import { parseRoute } from "../src/router";

describe("router", () => {
  it("routes the basics", () => {
    expect(parseRoute("/").kind).toBe("today");
    expect(parseRoute("/about").kind).toBe("about");
    expect(parseRoute("/tractates").kind).toBe("tractates");
    expect(parseRoute("/feed.xml").kind).toBe("feed");
    expect(parseRoute("/api/today.json").kind).toBe("api-today");
    expect(parseRoute("/yesterday")).toEqual({ kind: "relative", offset: -1 });
    expect(parseRoute("/date/2026-09-20")).toEqual({ kind: "date", ymd: "2026-09-20" });
  });
  it("routes dapim and validates ranges", () => {
    const r = parseRoute("/bekhorot/2");
    expect(r.kind).toBe("daf");
    if (r.kind === "daf") { expect(r.tractate.slug).toBe("bekhorot"); expect(r.daf).toBe(2); }
    expect(parseRoute("/bekhorot/1").kind).toBe("not-found");
    expect(parseRoute("/bekhorot/62").kind).toBe("not-found");
    expect(parseRoute("/kinnim/23").kind).toBe("daf");
    expect(parseRoute("/kinnim/2").kind).toBe("not-found");
    expect(parseRoute("/nope/2").kind).toBe("not-found");
    expect(parseRoute("/bekhorot/2b")).toEqual({ kind: "redirect", to: "/bekhorot/2#b" });
  });
  it("normalizes trailing slashes and case", () => {
    expect(parseRoute("/bekhorot/2/")).toEqual({ kind: "redirect", to: "/bekhorot/2" });
    expect(parseRoute("/Bekhorot/2")).toEqual({ kind: "redirect", to: "/bekhorot/2" });
    expect(parseRoute("/today")).toEqual({ kind: "redirect", to: "/" });
  });
  it("routes the newsletter before the tractate patterns", () => {
    expect(parseRoute("/newsletter").kind).toBe("newsletter");
    expect(parseRoute("/newsletter/confirm").kind).toBe("newsletter-confirm");
    expect(parseRoute("/newsletter/privacy").kind).toBe("newsletter-privacy");
    expect(parseRoute("/newsletter/hooks/resend").kind).toBe("newsletter-hook-resend");
    const token = "ab".repeat(24);
    expect(parseRoute(`/newsletter/u/${token}`)).toEqual({ kind: "newsletter-unsub", token });
    expect(parseRoute(`/newsletter/prefs/${token}`)).toEqual({ kind: "newsletter-prefs", token });
    expect(parseRoute(`/newsletter/u/${token.toUpperCase()}`)).toEqual({ kind: "redirect", to: `/newsletter/u/${token}` });
    expect(parseRoute("/newsletter/u/short").kind).toBe("not-found");
    expect(parseRoute("/newsletter/issue/2026-09-21")).toEqual({ kind: "newsletter-issue", ymd: "2026-09-21" });
    expect(parseRoute("/newsletter/")).toEqual({ kind: "redirect", to: "/newsletter" });
    expect(parseRoute("/admin/newsletter/status")).toEqual({ kind: "admin-newsletter", action: "status" });
    expect(parseRoute("/admin/newsletter/send")).toEqual({ kind: "admin-newsletter", action: "send" });
    expect(parseRoute("/admin/newsletter/subscribe")).toEqual({ kind: "admin-newsletter", action: "subscribe" });
    expect(parseRoute("/admin/newsletter/nope").kind).toBe("not-found");
  });
  it("routes tractate pages and the API", () => {
    expect(parseRoute("/bava-kamma").kind).toBe("tractate");
    const api = parseRoute("/api/bava-kamma/119.json");
    expect(api.kind).toBe("api-daf");
    expect(parseRoute("/api/bava-kamma/120.json").kind).toBe("not-found");
  });
});

describe("language prefixes", () => {
  it("wraps the page routes under /he", () => {
    expect(parseRoute("/he")).toEqual({ kind: "today", lang: "he" });
    expect(parseRoute("/he/")).toEqual({ kind: "redirect", to: "/he" });
    expect(parseRoute("/he/today")).toEqual({ kind: "redirect", to: "/he" });
    expect(parseRoute("/HE/Bekhorot/2")).toEqual({ kind: "redirect", to: "/he/bekhorot/2" });
    const r = parseRoute("/he/bekhorot/2");
    expect(r.kind).toBe("daf");
    if (r.kind === "daf") { expect(r.tractate.slug).toBe("bekhorot"); expect(r.daf).toBe(2); expect(r.lang).toBe("he"); }
    expect(parseRoute("/he/bekhorot/2b")).toEqual({ kind: "redirect", to: "/he/bekhorot/2#b" });
    expect(parseRoute("/he/bekhorot/62")).toEqual({ kind: "not-found", lang: "he" });
    expect(parseRoute("/he/tractates")).toEqual({ kind: "tractates", lang: "he" });
    expect(parseRoute("/he/about")).toEqual({ kind: "about", lang: "he" });
    expect(parseRoute("/he/feed.xml")).toEqual({ kind: "feed", lang: "he" });
    expect(parseRoute("/he/yesterday")).toEqual({ kind: "relative", offset: -1, lang: "he" });
    expect(parseRoute("/he/date/2026-09-21")).toEqual({ kind: "date", ymd: "2026-09-21", lang: "he" });
    expect(parseRoute("/he/bava-kamma").kind).toBe("tractate");
    expect(parseRoute("/he/nope")).toEqual({ kind: "not-found", lang: "he" });
  });
  it("keeps api, admin, newsletter and the machine routes English-only", () => {
    expect(parseRoute("/he/newsletter")).toEqual({ kind: "redirect", to: "/newsletter" });
    for (const path of ["/he/api/today.json", "/he/api/bekhorot/2.json", "/he/admin/bake", "/he/robots.txt", "/he/sitemap.xml", "/he/newsletter/privacy", "/he/lang/he"]) {
      expect(parseRoute(path), path).toEqual({ kind: "not-found", lang: "he" });
    }
    expect(parseRoute("/yi/bekhorot/2").kind).toBe("not-found"); // Yiddish is not enabled yet
    expect(parseRoute("/en/bekhorot/2").kind).toBe("not-found"); // English has no prefix
  });
  it("routes the language switch and the translation admin endpoints", () => {
    expect(parseRoute("/lang/he")).toEqual({ kind: "lang", lang: "he" });
    expect(parseRoute("/lang/en")).toEqual({ kind: "lang", lang: "en" });
    expect(parseRoute("/lang/fr").kind).toBe("not-found");
    expect(parseRoute("/admin/translate")).toEqual({ kind: "admin-translate", action: "run" });
    expect(parseRoute("/admin/translate/put")).toEqual({ kind: "admin-translate", action: "put" });
    expect(parseRoute("/admin/note")).toEqual({ kind: "admin-translate", action: "note" });
    expect(parseRoute("/admin/note/put")).toEqual({ kind: "admin-note-put" });
    expect(parseRoute("/he/admin/note/put")).toEqual({ kind: "not-found", lang: "he" });
    expect(parseRoute("/admin/map/bake")).toEqual({ kind: "admin-map", action: "bake" });
    expect(parseRoute("/admin/map/put")).toEqual({ kind: "admin-map", action: "put" });
    expect(parseRoute("/admin/map")).toEqual({ kind: "admin-map", action: "get" });
    expect(parseRoute("/he/admin/map")).toEqual({ kind: "not-found", lang: "he" });
  });
});
