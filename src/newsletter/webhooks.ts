/**
 * Resend delivery events, signed by Svix. Verification (Svix docs, read
 * 2026-09-20): the signed content is `${svix-id}.${svix-timestamp}.${body}`,
 * the key is the base64-decoded part of the secret after "whsec_", the
 * signature header holds one or more space-separated "v1,<base64>" entries,
 * any of which may match; reject timestamps outside a tolerance window.
 */
import type { NewsletterDb } from "./db";
import { emailHash, fromBase64url, normalizeEmail } from "./tokens";

export interface SvixHeaders { id: string | null; timestamp: string | null; signature: string | null }

export async function verifySvix(secret: string, h: SvixHeaders, body: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): Promise<boolean> {
  if (!h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) return false;
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try { keyBytes = fromBase64url(raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")); } catch { return false; }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const data = new TextEncoder().encode(`${h.id}.${h.timestamp}.${body}`);
  for (const part of h.signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    let sigBytes: Uint8Array;
    try { sigBytes = fromBase64url(sig.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")); } catch { continue; }
    if (await crypto.subtle.verify("HMAC", key, sigBytes, data)) return true;
  }
  return false;
}

export interface ResendEvent {
  type: string;
  created_at?: string;
  data?: { email_id?: string; to?: string[] | string; bounce?: { type?: string; subType?: string; message?: string } };
}

export type EventOutcome = "bounced" | "complained" | "ignored" | "duplicate";

/** Record the event once (the svix-id dedupes Resend's retries) and act on hard bounces and complaints. */
export async function applyResendEvent(db: NewsletterDb, hmacSecret: string, svixId: string, ev: ResendEvent, now: string): Promise<EventOutcome> {
  const to = Array.isArray(ev.data?.to) ? ev.data.to : ev.data?.to ? [ev.data.to] : [];
  const hashes = await Promise.all(to.map((a) => emailHash(hmacSecret, normalizeEmail(a))));
  const payload = JSON.stringify({ ...ev, data: { ...(ev.data ?? {}), to: undefined } });
  const fresh = await db.recordEvent({ provider_event_id: svixId, type: ev.type, email_hash: hashes[0] ?? null, subscriber_id: null, received_at: now, payload });
  if (!fresh) return "duplicate";
  if (ev.type === "email.bounced" && ev.data?.bounce?.type === "Permanent") {
    for (const h of hashes) { await db.markBounced(h, now); await db.addSuppression(h, "bounce", now); }
    return "bounced";
  }
  if (ev.type === "email.complained") {
    for (const h of hashes) { await db.markComplained(h, now); await db.addSuppression(h, "complaint", now); }
    return "complained";
  }
  return "ignored";
}
