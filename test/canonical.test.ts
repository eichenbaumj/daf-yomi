import { describe, expect, it } from "vitest";
import { canonicalRedirect } from "../src/index";
import type { Env } from "../src/types";

const env = { CANONICAL_HOST: "daf-yomi.dev" } as unknown as Env;
const go = (u: string) => canonicalRedirect(new URL(u), env);

describe("one canonical origin", () => {
  it("serves https://daf-yomi.dev as is", () => {
    expect(go("https://daf-yomi.dev/berakhot/2")).toBeNull();
    expect(go("https://daf-yomi.dev/")).toBeNull();
  });

  it("sends plain http to https, path and query kept", () => {
    expect(go("http://daf-yomi.dev/")).toBe("https://daf-yomi.dev/");
    expect(go("http://daf-yomi.dev/nedarim/26?src=x")).toBe("https://daf-yomi.dev/nedarim/26?src=x");
  });

  it("sends Cloudflare's other ports home (Google indexed :8080 pages as their own canonicals)", () => {
    expect(go("http://daf-yomi.dev:8080/nedarim/26")).toBe("https://daf-yomi.dev/nedarim/26");
    expect(go("https://daf-yomi.dev:8443/he/about")).toBe("https://daf-yomi.dev/he/about");
  });

  it("sends www and workers.dev home", () => {
    expect(go("https://www.daf-yomi.dev/about")).toBe("https://daf-yomi.dev/about");
    expect(go("https://daf-yomi.example.workers.dev/tractates")).toBe("https://daf-yomi.dev/tractates");
  });

  it("leaves local dev alone, on any port or scheme", () => {
    expect(go("http://localhost:8787/berakhot/2")).toBeNull();
    expect(go("http://127.0.0.1:8787/")).toBeNull();
  });

  it("does nothing without a canonical host", () => {
    expect(canonicalRedirect(new URL("http://anything.test:8080/"), {} as Env)).toBeNull();
  });
});
