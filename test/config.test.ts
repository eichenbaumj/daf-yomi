import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bakeTargets, nearTargets } from "../src/cron";
import { CARD_CRON } from "../src/og/bake";
import { SEND_CRON } from "../src/newsletter/send";
import { isIsraelTz, isRestDay } from "../src/newsletter/hebcal";
import { TIMEZONES, isValidTimezone } from "../src/newsletter/timezones";
import { ymd } from "../src/daf/schedule";

const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y!, m! - 1, dd!); };

describe("wrangler.jsonc", () => {
  const raw = readFileSync("wrangler.jsonc", "utf8").replace(/(^|\s)\/\/.*$/gm, "");
  const cfg = JSON.parse(raw) as { triggers: { crons: string[] }; d1_databases: { binding: string; migrations_dir: string }[]; vars: Record<string, string>; browser: { binding: string; remote?: boolean }; rules: { type: string; globs: string[] }[] };
  it("has the bake crons and the hourly send tick", () => {
    expect(cfg.triggers.crons).toContain("0 6 * * *");
    expect(cfg.triggers.crons).toContain("0 18 * * *");
    expect(cfg.triggers.crons).toContain(SEND_CRON);
    expect(cfg.triggers.crons).toContain(CARD_CRON);
    expect(cfg.triggers.crons.length).toBeLessThanOrEqual(5);
  });
  it("binds the newsletter database and vars", () => {
    expect(cfg.d1_databases[0]).toMatchObject({ binding: "NEWSLETTER_DB", migrations_dir: "migrations" });
  });
  it("binds Browser Rendering for the share cards, local in dev, with the card fonts as Data modules", () => {
    expect(cfg.browser).toEqual({ binding: "BROWSER" }); // no "remote": true, which would spend the daily budget from wrangler dev
    expect(cfg.rules.some((r) => r.type === "Data" && r.globs.includes("**/*.woff2"))).toBe(true);
    expect(Number(cfg.vars.OG_TRICKLE_PER_RUN)).toBeGreaterThan(0);
    expect(cfg.vars.NEWSLETTER_FROM).toMatch(/<daf@news\.daf-yomi\.dev>/);
    expect(cfg.vars.NEWSLETTER_PUBLIC).toBeDefined();
    expect(cfg.vars.CATCHUP_HOURS).toBe("3");
    expect(Number(cfg.vars.DAILY_GENERATION_CAP)).toBeGreaterThanOrEqual(18); // two runs of 3 notes + 3 translations + 3 maps
  });
});

describe("bake schedule", () => {
  it("bakes tomorrow, today, the day after, then the last week", () => {
    const targets = bakeTargets(d("2026-09-21")).map(ymd);
    expect(nearTargets(d("2026-09-21")).map(ymd)).toEqual(["2026-09-22", "2026-09-21", "2026-09-23"]); // tomorrow, today, the day after: the maps and translations walk these
    expect(targets.slice(0, 3)).toEqual(["2026-09-22", "2026-09-21", "2026-09-23"]);
    expect(targets.slice(3)).toEqual(["2026-09-20", "2026-09-19", "2026-09-18", "2026-09-17", "2026-09-16", "2026-09-15", "2026-09-14"]);
  });
});

describe("rest days", () => {
  it("knows Shabbat and Yom Tov on both calendars", () => {
    expect(isRestDay(d("2026-09-21"), false)).toBe(true); // Yom Kippur 5787
    expect(isRestDay(d("2026-09-21"), true)).toBe(true);
    expect(isRestDay(d("2026-09-22"), false)).toBe(false);
    expect(isRestDay(d("2026-09-26"), false)).toBe(true); // Shabbat (and Sukkot)
    expect(isRestDay(d("2026-10-04"), false)).toBe(true); // Simchat Torah in the diaspora
    expect(isRestDay(d("2026-10-04"), true)).toBe(false); // an ordinary Sunday in Israel
    expect(isRestDay(d("2026-10-10"), true)).toBe(true); // Shabbat
    expect(isRestDay(d("2026-12-15"), false)).toBe(false); // Chanukah is not a rest day
    expect(isIsraelTz("Asia/Jerusalem")).toBe(true);
    expect(isIsraelTz("America/New_York")).toBe(false);
  });
});

describe("time zones", () => {
  it("validates zones the way the site does", () => {
    for (const z of TIMEZONES) expect(isValidTimezone(z), z).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("<script>")).toBe(false);
  });
});
