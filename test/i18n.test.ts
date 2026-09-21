import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/en";
import { he } from "../src/i18n/he";
import { ENABLED_LANGS, p } from "../src/i18n/strings";
import { dafLabelL, hebrewDateL, longDateL, num, shortDateL } from "../src/i18n/format";
import { TRACTATES } from "../src/daf/tractates";

const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y!, m! - 1, dd!); };

/** Every string a table can produce, with Hebrew sample arguments so only the table's own Latin shows. */
function everyString(table: object): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(table)) {
    if (k === "lang") continue;
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) out.push(...v.map(String));
    else if (typeof v === "function") out.push(String((v as (...a: unknown[]) => unknown)("אב", "גד", 3, "הו", 5, 6, "ז", "ח")));
    else if (v && typeof v === "object") out.push(...Object.values(v as Record<string, string>));
  }
  return out;
}
const ALLOWED_LATIN = /AI|RSS|Pre-Release|CC BY-NC 4\.0|Daf Yomi|EN|\/he\/bekhorot\/2/g;
const stripMarkup = (s: string) => s.replace(/<[^>]+>/g, " ");

describe("the string tables", () => {
  it("have the same keys in every enabled language", () => {
    expect(ENABLED_LANGS).toContain("he");
    const enKeys = Object.keys(en).sort();
    expect(Object.keys(he).sort()).toEqual(enKeys);
    for (const k of enKeys) expect(typeof (he as unknown as Record<string, unknown>)[k], k).toBe(typeof (en as unknown as Record<string, unknown>)[k]);
  });
  it("carry no em dashes", () => {
    for (const s of [...everyString(en), ...everyString(he)]) expect(s, s).not.toMatch(/—/);
  });
  it("keep Hebrew free of Latin letters except the allowlist", () => {
    for (const s of everyString(he)) {
      const bare = stripMarkup(s).replace(ALLOWED_LATIN, "");
      expect(bare, s).not.toMatch(/[A-Za-z]/);
    }
  });
  it("keeps the English AI tells out of both", () => {
    for (const s of [...everyString(en), ...everyString(he)]) expect(s, s).not.toMatch(/\b(leverage|robust|seamless|holistic|delve)\b/i);
  });
});

describe("paths and labels", () => {
  it("prefixes every language but English", () => {
    expect(p("en", "/")).toBe("/");
    expect(p("en", "/bekhorot/2")).toBe("/bekhorot/2");
    expect(p("he", "/")).toBe("/he");
    expect(p("he", "/bekhorot/2")).toBe("/he/bekhorot/2");
    expect(p("he", "/feed.xml")).toBe("/he/feed.xml");
  });
  it("labels a daf in each language", () => {
    const bekhorot = TRACTATES.find((t) => t.slug === "bekhorot")!;
    expect(dafLabelL("en", bekhorot, 2)).toBe("Bekhorot 2");
    expect(dafLabelL("he", bekhorot, 2)).toBe("בכורות ב׳");
    expect(dafLabelL("he", bekhorot, 15)).toBe("בכורות ט״ו");
    expect(dafLabelL("he", bekhorot, 61)).toBe("בכורות ס״א");
  });
  it("formats dates in each language", () => {
    const day = d("2026-09-20");
    expect(longDateL("en", day)).toBe("Sunday, 20 September 2026");
    expect(longDateL("he", day)).toBe("יום ראשון, 20 בספטמבר 2026");
    expect(shortDateL("en", day)).toMatch(/^20 Sept? 2026$/); // ICU spells the short month Sep or Sept by version
    expect(shortDateL("he", day)).toMatch(/^20 ב.* 2026$/);
    expect(hebrewDateL("en", day)).toBe("9 Tishrei 5787");
    expect(hebrewDateL("he", day)).toBe("ט׳ תשרי תשפ״ז"); // no nikud
    expect(num("en", 2451)).toBe("2,451");
    expect(num("he", 2451)).toBe("2,451");
  });
});
