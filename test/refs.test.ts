import { describe, expect, it } from "vitest";
import { resolveDafRefs } from "../src/sefaria/client";
import { tractateBySlug, TRACTATES } from "../src/daf/tractates";

describe("resolveDafRefs", () => {
  it("fetches only side a for a tractate that ends on side a", async () => {
    const chullin = tractateBySlug("chullin")!;
    expect((await resolveDafRefs(chullin, 142, 14)).urlRefs).toEqual(["Chullin.142a"]);
    expect((await resolveDafRefs(chullin, 141, 14)).urlRefs).toEqual(["Chullin.141a", "Chullin.141b"]);
    const shevuot = tractateBySlug("shevuot")!;
    expect((await resolveDafRefs(shevuot, 49, 14)).urlRefs).toEqual(["Shevuot.49a", "Shevuot.49b"]);
  });
  it("every talmud-mode tractate records its last side", () => {
    for (const t of TRACTATES) expect(["a", "b"]).toContain(t.lastAmud);
  });
});
