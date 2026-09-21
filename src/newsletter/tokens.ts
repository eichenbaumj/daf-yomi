/**
 * Tokens and hashes for the newsletter, on WebCrypto only, so the same code
 * runs in the Worker and in vitest's Node environment.
 *
 * - unsub/prefs tokens: 48 lowercase hex characters, random, stored on the row.
 *   Lowercase because the router lower-cases every path before matching.
 * - confirmation tokens: base64url(JSON payload) + "." + base64url(HMAC-SHA256),
 *   carried in a query string (never a path), 48 h expiry, verified in constant time.
 * - email hashes: HMAC-SHA256 of the lowercased address; the only form of an
 *   address that events and the suppression list ever hold.
 */

const enc = new TextEncoder();

export function randomHex(bytes = 24): string {
  const u8 = new Uint8Array(bytes);
  crypto.getRandomValues(u8);
  return Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64url(u8: Uint8Array): string {
  let bin = "";
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keyCache.set(secret, k);
  }
  return k;
}
async function hmac(secret: string, data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(data)));
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
/** Cheap syntactic check; the confirmation email is the real one. */
export function looksLikeEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function emailHash(secret: string, email: string): Promise<string> {
  return base64url(await hmac(secret, `hash:${normalizeEmail(email)}`));
}

export interface ConfirmPayload {
  email: string;
  tz: string;
  hour: number;
  edition: "today" | "tomorrow";
  hold: 0 | 1;
  /** Version string of the consent text shown on the form. */
  consent: string;
  /** Expiry, ms since epoch. */
  exp: number;
  nonce: string;
}

export const CONFIRM_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

export async function signConfirmToken(secret: string, p: ConfirmPayload): Promise<string> {
  const body = base64url(enc.encode(JSON.stringify(p)));
  const sig = base64url(await hmac(secret, body));
  return `${body}.${sig}`;
}

export async function verifyConfirmToken(secret: string, token: string, now = Date.now()): Promise<ConfirmPayload | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64url(sig), enc.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  let p: unknown;
  try {
    p = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
  } catch {
    return null;
  }
  if (!isConfirmPayload(p)) return null;
  if (p.exp <= now) return null;
  return p;
}

function isConfirmPayload(x: unknown): x is ConfirmPayload {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.email === "string" && typeof o.tz === "string" && typeof o.hour === "number" && Number.isInteger(o.hour) && o.hour >= 0 && o.hour <= 23
    && (o.edition === "today" || o.edition === "tomorrow") && (o.hold === 0 || o.hold === 1)
    && typeof o.consent === "string" && typeof o.exp === "number" && typeof o.nonce === "string";
}

/** Constant-time comparison for bearer tokens and webhook signatures. */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(32)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const [ha, hb] = await Promise.all([crypto.subtle.sign("HMAC", key, enc.encode(a)), crypto.subtle.sign("HMAC", key, enc.encode(b))]);
  const ua = new Uint8Array(ha), ub = new Uint8Array(hb);
  let diff = ua.length ^ ub.length;
  for (let i = 0; i < ua.length; i++) diff |= ua[i]! ^ (ub[i] ?? 0);
  return diff === 0;
}
