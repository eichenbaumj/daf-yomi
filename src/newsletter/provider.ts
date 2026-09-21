/**
 * The seam between the newsletter and whoever carries the mail. Resend first
 * (free to about 90 daily readers); Amazon SES is the planned second
 * implementation once the list nears that line. Nothing above this interface
 * knows which one is in use.
 */
export interface OutboundEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** Short ASCII tag for the provider dashboard, e.g. the edition date. */
  tag?: string;
}

export type BatchOutcome =
  | { ok: true; ids: string[] }
  | { ok: false; status: number; body: string; retryable: boolean; treatAsSent: boolean };

export type SingleOutcome =
  | { ok: true; id: string }
  | { ok: false; status: number; body: string; retryable: boolean };

export interface EmailProvider {
  readonly name: string;
  /** Up to `maxBatch` messages in one call; the idempotency key makes a retry of the same chunk safe. */
  readonly maxBatch: number;
  sendBatch(emails: OutboundEmail[], idempotencyKey: string): Promise<BatchOutcome>;
  sendOne(email: OutboundEmail, idempotencyKey?: string): Promise<SingleOutcome>;
}
