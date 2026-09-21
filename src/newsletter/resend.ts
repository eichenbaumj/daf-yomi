/**
 * Resend over plain fetch (no SDK). Facts relied on, from resend.com/docs read
 * 2026-09-20: POST /emails/batch takes up to 100 emails and returns
 * { data: [{ id }] } in order; an Idempotency-Key (≤ 256 chars) is remembered
 * for 24 h, a replay with the same payload returns the original response and a
 * replay with a different payload returns 409 invalid_idempotent_request;
 * 10 requests per second per team; the free plan sends 100 emails a day.
 */
import type { BatchOutcome, EmailProvider, OutboundEmail, SingleOutcome } from "./provider";

const API = "https://api.resend.com";

interface ResendPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
}

function toPayload(e: OutboundEmail): ResendPayload {
  const p: ResendPayload = { from: e.from, to: [e.to], subject: e.subject, html: e.html, text: e.text };
  if (e.replyTo) p.reply_to = e.replyTo;
  if (e.headers) p.headers = e.headers;
  if (e.tag) p.tags = [{ name: "edition", value: e.tag.replace(/[^A-Za-z0-9_-]/g, "-") }];
  return p;
}

function classify(status: number): { retryable: boolean; treatAsSent: boolean } {
  return { retryable: status === 429 || status >= 500, treatAsSent: status === 409 };
}

export function resendProvider(apiKey: string, fetchImpl: typeof fetch = fetch): EmailProvider {
  const call = async (path: string, body: unknown, idempotencyKey?: string): Promise<{ status: number; text: string }> => {
    const headers: Record<string, string> = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    try {
      const res = await fetchImpl(`${API}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      return { status: res.status, text: await res.text() };
    } catch (e) {
      return { status: 0, text: e instanceof Error ? e.message : String(e) };
    }
  };
  return {
    name: "resend",
    maxBatch: 100,
    async sendBatch(emails, idempotencyKey): Promise<BatchOutcome> {
      if (emails.length === 0) return { ok: true, ids: [] };
      if (emails.length > 100) return { ok: false, status: 0, body: "batch too large", retryable: false, treatAsSent: false };
      const { status, text } = await call("/emails/batch", emails.map(toPayload), idempotencyKey);
      if (status >= 200 && status < 300) {
        let ids: string[] = [];
        try {
          const parsed = JSON.parse(text) as { data?: { id?: string }[] };
          ids = (parsed.data ?? []).map((d) => d.id ?? "");
        } catch { /* ids stay empty; the rows are still marked sent */ }
        while (ids.length < emails.length) ids.push("");
        return { ok: true, ids };
      }
      const c = status === 0 ? { retryable: true, treatAsSent: false } : classify(status);
      return { ok: false, status, body: text.slice(0, 500), ...c };
    },
    async sendOne(email, idempotencyKey): Promise<SingleOutcome> {
      const { status, text } = await call("/emails", toPayload(email), idempotencyKey);
      if (status >= 200 && status < 300) {
        let id = "";
        try { id = (JSON.parse(text) as { id?: string }).id ?? ""; } catch { /* fine */ }
        return { ok: true, id };
      }
      return { ok: false, status, body: text.slice(0, 500), retryable: status === 0 || classify(status).retryable };
    },
  };
}

/** Headers every issue carries. RFC 8058 one-click plus the human link in the footer; Gmail and Yahoo look for both. */
export function issueHeaders(origin: string, unsubToken: string, listDomain: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${origin}/newsletter/u/${unsubToken}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "List-ID": `Today's Daf daily <daily.${listDomain}>`,
    "Feedback-ID": "daily::todaysdaf",
    Precedence: "bulk",
  };
}
