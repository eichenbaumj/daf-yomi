import { describe, expect, it } from "vitest";
import { base64url, emailHash, fromBase64url, ipHash, looksLikeEmail, normalizeEmail, randomHex, signConfirmToken, timingSafeEqual, verifyConfirmToken, type ConfirmPayload } from "../src/newsletter/tokens";

const secret = "test-secret-0123456789abcdef";
const payload: ConfirmPayload = { email: "reader@example.test", tz: "America/New_York", hour: 6, edition: "today", hold: 0, consent: "2026-09-v1", exp: Date.now() + 60_000, nonce: "abc" };

describe("tokens", () => {
  it("round-trips a confirmation token", async () => {
    const t = await signConfirmToken(secret, payload);
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await verifyConfirmToken(secret, t)).toEqual(payload);
  });
  it("rejects expiry, tampering and the wrong secret", async () => {
    const t = await signConfirmToken(secret, payload);
    expect(await verifyConfirmToken(secret, t, payload.exp + 1)).toBeNull();
    const [body, sig] = t.split(".") as [string, string];
    // Flip a character in the middle: the last base64url character only carries padding bits.
    const flipped = sig.slice(0, 5) + (sig[5] === "A" ? "B" : "A") + sig.slice(6);
    expect(await verifyConfirmToken(secret, `${body}.${flipped}`)).toBeNull();
    const edited = base64url(new TextEncoder().encode(JSON.stringify({ ...payload, email: "other@example.test" })));
    expect(await verifyConfirmToken(secret, `${edited}.${sig}`)).toBeNull();
    expect(await verifyConfirmToken("another-secret", t)).toBeNull();
    expect(await verifyConfirmToken(secret, "garbage")).toBeNull();
    expect(await verifyConfirmToken(secret, "")).toBeNull();
    expect(await verifyConfirmToken(secret, `${body}.`)).toBeNull();
  });
  it("rejects a malformed payload even when correctly signed", async () => {
    const t = await signConfirmToken(secret, { ...payload, hour: 26 } as ConfirmPayload);
    expect(await verifyConfirmToken(secret, t)).toBeNull();
  });
  it("makes lowercase hex tokens the router will not rewrite", () => {
    const h = randomHex(24);
    expect(h).toMatch(/^[0-9a-f]{48}$/);
    expect(randomHex(24)).not.toBe(h);
  });
  it("hashes an IP one way, so the rate limit never keys on the address itself", async () => {
    const a = await ipHash(secret, "203.0.113.7");
    expect(a).toBe(await ipHash(secret, "203.0.113.7"));
    expect(a).not.toBe(await ipHash(secret, "203.0.113.8"));
    expect(a).not.toBe(await ipHash("other", "203.0.113.7"));
    expect(a).not.toContain("203.0.113");
    expect(a).not.toBe(await emailHash(secret, "203.0.113.7")); // a different domain of the same secret
  });
  it("hashes addresses case-insensitively and deterministically", async () => {
    const a = await emailHash(secret, "Reader@Example.test ");
    expect(a).toBe(await emailHash(secret, "reader@example.test"));
    expect(a).not.toBe(await emailHash(secret, "other@example.test"));
    expect(a).not.toBe(await emailHash("other", "reader@example.test"));
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("base64url round-trips bytes", () => {
    const u8 = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(fromBase64url(base64url(u8))).toEqual(u8);
    expect(base64url(u8)).not.toMatch(/[+/=]/);
  });
  it("checks addresses loosely and compares in constant time", async () => {
    expect(looksLikeEmail("a@b.co")).toBe(true);
    expect(looksLikeEmail("not an email")).toBe(false);
    expect(looksLikeEmail("a@b")).toBe(false);
    expect(normalizeEmail("  A@B.CO ")).toBe("a@b.co");
    expect(await timingSafeEqual("abc", "abc")).toBe(true);
    expect(await timingSafeEqual("abc", "abd")).toBe(false);
    expect(await timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
