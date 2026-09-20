import { describe, expect, it } from "vitest";
import { chaptersForDaf, positionFor } from "../src/daf/position";
import { dafForDate } from "../src/daf/schedule";
import { tractateBySlug } from "../src/daf/tractates";

const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y!, m! - 1, dd!); };

describe("position", () => {
  it("describes Bekhorot 2", () => {
    const p = positionFor(dafForDate(d("2026-09-20")));
    expect(p.seder).toBe("Seder Kodashim");
    expect(p.tractate).toBe("Bekhorot");
    expect(p.chapterLabel).toBe("Chapter 1 of 9");
    expect(p.dafOfTractate).toBe("Daf 2 of 61");
    expect(p.dayInCycle).toBe(2451);
    expect(p.cycleLength).toBe(2711);
  });
  it("flags a daf where one chapter ends and the next begins", () => {
    const b = tractateBySlug("bekhorot")!;
    // Chapter 1 ends 13a, chapter 2 begins 13a (Sefaria alt structure)
    const chs = chaptersForDaf(b, 13);
    expect(chs.length).toBe(2);
    const p = positionFor({ tractate: b, daf: 13, cycle: 14, dayInCycle: 1 });
    expect(p.chapterLabel).toBe("Chapters 1–2 of 9");
  });
  it("leaves the chapter blank where Sefaria has no chapter structure", () => {
    const k = tractateBySlug("kinnim")!;
    expect(positionFor({ tractate: k, daf: 23, cycle: 14, dayInCycle: 1 }).chapterLabel).toBe("");
  });
});
