import { describe, expect, it } from "vitest";
import { hashMapPrompt, MAP_PROMPT_VERSION, mapUserMessage, MapSchema } from "../src/map/prompt";
import { MAP_KINDS } from "../src/map/kinds";
import { cueSegments } from "../src/map/cues";
import { sec } from "./map-cues.test";

const sections = [sec("Bekhorot 4a", "a", ["GEMARA: opens", "then"]), sec("Bekhorot 4b", "b", ["more", "§ a new passage"])];

describe("map prompt", () => {
  it("fingerprints the style guide", () => {
    expect(hashMapPrompt()).toMatch(new RegExp(`^${MAP_PROMPT_VERSION.replace(/\./g, "\\.")}-[0-9a-f]+$`));
  });
  it("numbers the page and names the marks the model must honour", () => {
    const msg = mapUserMessage({ label: "Bekhorot 4", positionLine: "p", sections, cues: cueSegments(sections) });
    expect(msg).toContain("[a-1] GEMARA: opens");
    expect(msg).toContain("[b-2] § a new passage");
    expect(msg).toContain('must be the "from" of a unit: a-1 (GEMARA), b-2 (§)');
    expect(msg).not.toContain("previous attempt");
    const bare = mapUserMessage({ label: "Shabbat 20", positionLine: "p", sections, cues: [] });
    expect(bare).toContain("carries no section marks on this page");
    const retry = mapUserMessage({ label: "Bekhorot 4", positionLine: "p", sections, cues: [], feedback: "gap: a-2." });
    expect(retry).toMatch(/Your previous attempt was rejected: gap: a-2\. Fix that/);
  });
  it("has twelve distinct kinds the schema enforces", () => {
    expect(new Set(MAP_KINDS).size).toBe(12);
    expect(MapSchema.safeParse({ units: [{ from: "a-1", to: "a-1", kind: "lesson", title: "t", gloss: "g" }], shape: "s" }).success).toBe(false);
    expect(MapSchema.safeParse({ units: [{ from: "a-1", to: "a-1", kind: "mishna", title: "t", gloss: "g" }], shape: "s" }).success).toBe(true);
  });
});
