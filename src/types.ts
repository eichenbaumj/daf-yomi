export interface Env {
  DAF_KV: KVNamespace;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  SITE_NAME: string;
  SITE_TAGLINE: string;
  /** Hostname every other host redirects to. Empty/undefined disables the redirect (dev). */
  CANONICAL_HOST?: string;
  DEFAULT_TIMEZONE: string;
  NOTE_MODEL: string;
  /** Set at deploy time (git short sha) and folded into edge-cache keys. */
  BUILD?: string;
  /** Max paid note generations per UTC day outside of forced admin bakes. */
  DAILY_GENERATION_CAP?: string;
  /** Bearer token for the /admin/* endpoints (secret). Unset closes them. */
  ADMIN_TOKEN?: string;

  // ---- Newsletter (src/newsletter) ----
  /** D1: subscribers, deliveries, rendered editions, send runs, provider events, suppressions. */
  NEWSLETTER_DB: D1Database;
  /** Cloudflare send_email binding restricted to the owner's verified address; alerts only. Optional until bound. */
  ALERT?: SendEmail;
  /** Rate Limiting binding for the subscribe form. Optional: the edge-cache throttle covers its absence. */
  SUBSCRIBE_RL?: RateLimit;
  /** Secrets. */
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Signs confirmation links and hashes addresses for the suppression list. */
  TOKEN_HMAC_SECRET?: string;
  /** Vars. */
  TURNSTILE_SITE_KEY?: string;
  ALERT_EMAIL?: string;
  /** "Today's Daf <daf@news.daf-yomi.dev>" */
  NEWSLETTER_FROM?: string;
  NEWSLETTER_REPLY_TO?: string;
  /** Hours after a subscriber's chosen hour during which a missed send is still made. */
  CATCHUP_HOURS?: string;
  /** "1" shows the Hebrew tractate title in the email; "0" drops the only RTL run (kill switch for the Gmail RTL bug). */
  EMAIL_HEBREW?: string;
  /** "1" shows the Newsletter nav tab and the subscribe form; "0" hides them so code can ship before launch. */
  NEWSLETTER_PUBLIC?: string;
}
