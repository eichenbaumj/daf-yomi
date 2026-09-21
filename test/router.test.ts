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
    expect(parseRoute("/admin/newsletter/nope").kind).toBe("not-found");
  });
  it("routes tractate pages and the API", () => {
    expect(parseRoute("/bava-kamma").kind).toBe("tractate");
    const api = parseRoute("/api/bava-kamma/119.json");
    expect(api.kind).toBe("api-daf");
    expect(parseRoute("/api/bava-kamma/120.json").kind).toBe("not-found");
  });
});
