import { describe, expect, it } from "vitest";
import { adjacentDaf, cycleEndDate, cycleStartDate, dafForDate, dateForDaf, todayIn, ymd, hebrewDate } from "../src/daf/schedule";
import { CYCLE_LENGTH, TRACTATES, tractateBySlug } from "../src/daf/tractates";

const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y!, m! - 1, dd!); };

describe("schedule", () => {
  it("knows today's daf (2026-09-20 = Bekhorot 2, verified against Sefaria and Hebcal)", () => {
    const r = dafForDate(d("2026-09-20"));
    expect(r.tractate.slug).toBe("bekhorot");
    expect(r.daf).toBe(2);
    expect(r.cycle).toBe(14);
  });
  it("cycle 14 runs 5 Jan 2020 (Berakhot 2, day 1) to 7 Jun 2027 (Niddah 73, day 2711)", () => {
    const first = dafForDate(d("2020-01-05"));
    expect(first.tractate.slug).toBe("berakhot"); expect(first.daf).toBe(2); expect(first.dayInCycle).toBe(1);
    const last = dafForDate(d("2027-06-07"));
    expect(last.tractate.slug).toBe("niddah"); expect(last.daf).toBe(73); expect(last.dayInCycle).toBe(CYCLE_LENGTH);
    expect(ymd(cycleStartDate(14))).toBe("2020-01-05");
    expect(ymd(cycleEndDate(14))).toBe("2027-06-07");
    expect(dafForDate(d("2027-06-08")).cycle).toBe(15);
  });
  it("round-trips every day of cycle 14 (date → daf → date)", () => {
    let date = d("2020-01-05");
    for (let i = 0; i < CYCLE_LENGTH; i++) {
      const r = dafForDate(date);
      expect(r.dayInCycle).toBe(i + 1);
      const back = dateForDaf(r.tractate, r.daf, r.cycle);
      expect(ymd(back)).toBe(ymd(date));
      date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    }
  });
  it("handles Shekalim, Kinnim, Tamid, Middot", () => {
    expect(dafForDate(d("2021-03-25")).tractate.slug).toBe("shekalim");
    expect(dafForDate(d("2021-03-25")).daf).toBe(4);
    const k = dafForDate(d("2027-03-13")); expect(k.tractate.slug).toBe("kinnim"); expect(k.daf).toBe(23);
    const t = dafForDate(d("2027-03-16")); expect(t.tractate.slug).toBe("tamid"); expect(t.daf).toBe(26);
    const m = dafForDate(d("2027-03-27")); expect(m.tractate.slug).toBe("middot"); expect(m.daf).toBe(37);
    expect(dafForDate(d("2027-03-28")).tractate.slug).toBe("niddah");
  });
  it("walks across tractate boundaries", () => {
    const chullin = tractateBySlug("chullin")!;
    const next = adjacentDaf(chullin, chullin.lastDaf, 1)!;
    expect(next.tractate.slug).toBe("bekhorot"); expect(next.daf).toBe(2);
    const prev = adjacentDaf(tractateBySlug("bekhorot")!, 2, -1)!;
    expect(prev.tractate.slug).toBe("chullin"); expect(prev.daf).toBe(142);
    expect(adjacentDaf(TRACTATES[0]!, 2, -1)).toBeNull();
    expect(adjacentDaf(TRACTATES[TRACTATES.length - 1]!, 73, 1)).toBeNull();
  });
  it("resolves the civil date in a timezone", () => {
    const at = new Date(Date.UTC(2026, 8, 20, 3, 30)); // 03:30Z = still 19 Sep in New York, already 20 Sep in Jerusalem
    expect(ymd(todayIn("America/New_York", at))).toBe("2026-09-19");
    expect(ymd(todayIn("Asia/Jerusalem", at))).toBe("2026-09-20");
    expect(ymd(todayIn("Not/AZone", at))).toBe("2026-09-20"); // falls back to UTC
  });
  it("renders the Hebrew date", () => {
    expect(hebrewDate(d("2026-09-20"))).toBe("9 Tishrei 5787");
  });
});

describe("tractate table", () => {
  it("sums to one cycle and has unique slugs", () => {
    expect(TRACTATES.reduce((s, t) => s + t.days, 0)).toBe(2711);
    expect(new Set(TRACTATES.map((t) => t.slug)).size).toBe(TRACTATES.length);
    expect(TRACTATES.length).toBe(40);
  });
  it("orders match hebcal's", () => {
    expect(TRACTATES.map((t) => t.order)).toEqual(TRACTATES.map((_, i) => i));
    expect(TRACTATES[0]!.slug).toBe("berakhot");
    expect(TRACTATES[39]!.slug).toBe("niddah");
  });
  it("has chapter ranges for Bavli tractates", () => {
    const b = tractateBySlug("bekhorot")!;
    expect(b.chapters.length).toBe(9);
    expect(b.chapters[0]!.startDaf).toBe("2a");
    expect(b.seder).toBe("Seder Kodashim");
  });
});
