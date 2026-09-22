import { describe, expect, it } from "vitest";
import { ensureMap, type MapDeps, type MapDraftResult } from "../src/map/generate";
import { mapKey, type DafMap } from "../src/map/store";
import { hashMapPrompt, type MapDraft } from "../src/map/prompt";
import { cueSegments, sourceTextOf } from "../src/map/cues";
import { dafForDate } from "../src/daf/schedule";
import type { Env } from "../src/types";
import { FakeKV } from "./helpers/fakeKv";
import { sec } from "./map-cues.test";

const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y!, m! - 1, dd!); };
const ref = dafForDate(d("2026-09-21")); // Bekhorot 3
const sections = [
  sec("Bekhorot 3a", "a", [
    "MISHNA: With regard to one who purchases the fetus of a donkey that belongs to a gentile, and one who sells the fetus of his donkey to a gentile, the donkeys are exempt from the obligations of firstborn status, and so is one who enters a partnership with him.",
    "GEMARA: The Gemara asks: Why do I need all these examples in the mishna?",
    "Rav Huna said: each case teaches something the others do not.",
  ]),
  sec("Bekhorot 3b", "b", ["Rav Huna said: even the animal's ear is enough of a share.", "§ Rav Ḥisda said: only a part the animal could not live without.", "The dispute stands."]),
];
const sourceText = sourceTextOf(sections);
const usage = { inputTokens: 100, outputTokens: 10 };
const good: MapDraft = {
  units: [
    { from: "a-1", to: "a-1", kind: "mishna", title: "Five who owe nothing for a donkey", gloss: "The mishna lists five ways a Jew and a gentile share a donkey, and in each the firstborn owes nothing." },
    { from: "a-2", to: "a-3", kind: "question", title: "Why five cases and not one", gloss: "The Gemara asks why the mishna needs every case when one principle would do, and Rav Huna answers." },
    { from: "b-1", to: "b-1", kind: "case", title: "An ear as a share", gloss: "Rav Huna says even the animal's ear counts as the gentile's share." },
    { from: "b-2", to: "b-3", kind: "dispute", title: "Rav Huna against Rav Hisda on the ear", gloss: "Rav Ḥisda wants a part the animal cannot live without, and the page leaves the two views standing." },
  ],
  shape: "A mishna with five cases, one question about why five, and a dispute over how small a gentile's share can be.",
};
const gapped: MapDraft = { ...good, units: [good.units[0]!, { ...good.units[1]!, from: "a-3" }, good.units[2]!, good.units[3]!] };

function harness(drafts: (MapDraft | null)[], cap = "18") {
  const kv = new FakeKV();
  const env = { DAF_KV: kv as unknown as KVNamespace, ANTHROPIC_API_KEY: "k", NOTE_MODEL: "m", DAILY_GENERATION_CAP: cap } as unknown as Env;
  const seen: { feedback: string[] } = { feedback: [] };
  const deps: MapDeps = {
    buildInput: async () => ({ input: { label: "Bekhorot 3", positionLine: "p", sections, cues: cueSegments(sections) }, sources: ["Bekhorot.3a", "Bekhorot.3b"], sourceText }),
    draft: async (input): Promise<MapDraftResult> => { seen.feedback.push(input.feedback ?? ""); const next = drafts.shift(); return next === null ? { draft: null, refusal: "declined", usage } : { draft: next ?? null, usage }; },
  };
  const stored = () => kv.get(mapKey(ref.tractate, ref.daf), "json") as Promise<DafMap | null>;
  return { env, deps, seen, kv, stored };
}

describe("ensureMap", () => {
  it("retries once with the gate's feedback and stores the map that chains", async () => {
    const h = harness([gapped, good]);
    const out = await ensureMap(h.env, ref, {}, h.deps);
    expect(out.status).toBe("generated");
    if (out.status !== "generated") return;
    expect(out.attempts).toBe(2);
    expect(out.firstAttemptProblems).toContainEqual(expect.stringMatching(/gap: segments a-2 to a-2/));
    expect(h.seen.feedback[1]).toMatch(/gap: segments a-2 to a-2/);
    const map = await h.stored();
    expect(map?.units.map((u) => u.from)).toEqual(["a-1", "a-2", "b-1", "b-2"]);
    expect(map?.promptVersion).toBe(hashMapPrompt());
    expect(map?.segmentCounts).toEqual([3, 3]);
    expect(map?.sources).toEqual(["Bekhorot.3a", "Bekhorot.3b"]);
    expect(map?.usage).toEqual({ inputTokens: 200, outputTokens: 20, attempts: 2, estUsd: expect.any(Number) });
    expect(h.kv.writes).toBe(2); // the gen: counter and the map
  });
  it("gives up after two drafts that fail the gate and stores nothing", async () => {
    const h = harness([gapped, gapped, good]);
    const out = await ensureMap(h.env, ref, {}, h.deps);
    expect(out.status).toBe("failed");
    if (out.status !== "failed") return;
    expect(out.reason).toBe("map failed the gate twice");
    expect(out.problems).toContainEqual(expect.stringMatching(/gap/));
    expect(await h.stored()).toBeNull();
    expect(h.kv.writes).toBe(1);
  });
  it("returns the stored map unless forced", async () => {
    const h = harness([good, good]);
    await ensureMap(h.env, ref, {}, h.deps);
    const again = await ensureMap(h.env, ref, {}, h.deps);
    expect(again.status).toBe("exists");
    const forced = await ensureMap(h.env, ref, { force: true }, h.deps);
    expect(forced.status).toBe("generated");
    expect(h.seen.feedback.length).toBe(2);
  });
  it("respects the shared daily cap and the missing key", async () => {
    const h = harness([good]);
    await h.kv.put("gen:" + new Date().toISOString().slice(0, 10), "18");
    const capped = await ensureMap(h.env, ref, {}, h.deps);
    expect(capped).toEqual({ status: "skipped", reason: "daily generation cap of 18 reached (18 today)" });
    const noKey = await ensureMap({ ...h.env, ANTHROPIC_API_KEY: undefined } as unknown as Env, ref, {}, { buildInput: h.deps.buildInput });
    expect(noKey.status).toBe("skipped");
  });
  it("reports a refusal or cut-off draft as a failure", async () => {
    const h = harness([null]);
    const out = await ensureMap(h.env, ref, {}, h.deps);
    expect(out).toMatchObject({ status: "failed", reason: "refused: declined" });
  });
});
