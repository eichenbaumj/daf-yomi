import { describe, expect, it } from "vitest";
import { switchLanguage } from "../src/index";
import type { Env } from "../src/types";

const env = (hePublic: string) => ({ HE_PUBLIC: hePublic, SITE_NAME: "Today's Daf" }) as unknown as Env;
const cookie = (r: Response) => r.headers.get("set-cookie") ?? "";

describe("the language switch and its cookie", () => {
  it("does not remember a Pre-Release language: it clears the cookie and still goes to the page", () => {
    const r = switchLanguage(new URL("https://daf-yomi.dev/lang/he?to=%2Fabout"), "he", env("0"));
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/he/about");
    expect(cookie(r)).toContain("daf_lang=;");
    expect(cookie(r)).toContain("Max-Age=0");
  });

  it("remembers a public language for a year", () => {
    const r = switchLanguage(new URL("https://daf-yomi.dev/lang/he?to=%2F"), "he", env("1"));
    expect(r.headers.get("location")).toBe("/he");
    expect(cookie(r)).toContain("daf_lang=he;");
    expect(cookie(r)).toContain("Max-Age=31536000");
  });

  it("English always clears the cookie", () => {
    const r = switchLanguage(new URL("https://daf-yomi.dev/lang/en?to=%2Fhe%2Fberakhot%2F2"), "en", env("1"));
    expect(r.headers.get("location")).toBe("/berakhot/2");
    expect(cookie(r)).toContain("Max-Age=0");
  });

  it("never echoes an open redirect", () => {
    const r = switchLanguage(new URL("https://daf-yomi.dev/lang/en?to=%2F%2Fevil.com"), "en", env("1"));
    expect(r.headers.get("location")).toBe("/");
  });
});
