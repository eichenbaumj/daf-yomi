import { describe, expect, it } from "vitest";
import { applyResendEvent, verifySvix } from "../src/newsletter/webhooks";
import { emailHash } from "../src/newsletter/tokens";
import { fakeDb } from "./helpers/fakeDb";

const keyBytes = new Uint8Array(32).map((_, i) => (i * 7 + 3) % 256);
const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));
const secret = `whsec_${b64(keyBytes)}`;

async function sign(id: string, ts: string, body: string, key = keyBytes): Promise<string> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `v1,${b64(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${id}.${ts}.${body}`))))}`;
}

describe("Svix verification", () => {
  const body = JSON.stringify({ type: "email.bounced", data: { to: ["a@example.test"], bounce: { type: "Permanent" } } });
  const now = 1_800_000_000;
  const ts = String(now);
  it("accepts a valid signature and rejects tampering", async () => {
    const sig = await sign("msg_1", ts, body);
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: sig }, body, now)).toBe(true);
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: sig }, body + " ", now)).toBe(false);
    expect(await verifySvix(secret, { id: "msg_2", timestamp: ts, signature: sig }, body, now)).toBe(false);
    expect(await verifySvix(`whsec_${b64(new Uint8Array(32))}`, { id: "msg_1", timestamp: ts, signature: sig }, body, now)).toBe(false);
    expect(await verifySvix(secret, { id: null, timestamp: ts, signature: sig }, body, now)).toBe(false);
  });
  it("rejects stale timestamps and accepts any matching signature in the list", async () => {
    const sig = await sign("msg_1", ts, body);
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: sig }, body, now + 301)).toBe(false);
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,AAAA ${sig}` }, body, now)).toBe(true);
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v2,${sig.slice(3)}` }, body, now)).toBe(false);
  });
});

describe("Resend events", () => {
  it("marks hard bounces and complaints, suppresses the address, and dedupes retries", async () => {
    const db = fakeDb();
    const hmac = "hmac-secret";
    const h = await emailHash(hmac, "a@example.test");
    db.addSubscriber({ email: "a@example.test", tz: "UTC", email_hash: h });
    const bounced = { type: "email.bounced", data: { to: ["A@example.test"], bounce: { type: "Permanent", subType: "General" } } };
    expect(await applyResendEvent(db, hmac, "svix_1", bounced, "now")).toBe("bounced");
    expect(db.subscribers[0]!.status).toBe("bounced");
    expect(db.suppressions.get(h)).toBe("bounce");
    expect(await applyResendEvent(db, hmac, "svix_1", bounced, "now")).toBe("duplicate");
    expect(await applyResendEvent(db, hmac, "svix_2", { type: "email.bounced", data: { to: ["a@example.test"], bounce: { type: "Transient" } } }, "now")).toBe("ignored");
    expect(await applyResendEvent(db, hmac, "svix_3", { type: "email.complained", data: { to: "a@example.test" } }, "now")).toBe("complained");
    expect(db.subscribers[0]!.status).toBe("complained");
    expect(db.suppressions.get(h)).toBe("bounce"); // first reason kept
    expect(db.events.every((e) => !e.payload?.includes("example.test"))).toBe(true); // addresses never stored in events
    expect(await applyResendEvent(db, hmac, "svix_4", { type: "email.delivered", data: { to: ["a@example.test"] } }, "now")).toBe("ignored");
  });
});
