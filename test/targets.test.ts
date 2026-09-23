import { describe, expect, it } from "vitest";
import { restOfCycle } from "../scripts/lib/targets";
import { dafForDate } from "../src/daf/schedule";

const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y!, m! - 1, dd!); };

describe("the rest of the cycle", () => {
  it("runs from tomorrow to the last daf of the current cycle and no further", () => {
    const from = d("2026-09-22"); // Bekhorot 4, day 2,453 of 2,711
    const rest = restOfCycle(from);
    expect(rest[0]).toMatchObject({ daf: 5 });
    expect(rest[0]!.tractate.slug).toBe("bekhorot");
    expect(rest.length).toBe(2711 - 2453);
    expect(rest[rest.length - 1]!.tractate.slug).toBe("niddah");
    expect(new Set(rest.map((r) => r.cycle)).size).toBe(1);
    expect(rest[rest.length - 1]!.cycle).toBe(dafForDate(from).cycle);
  });
});
