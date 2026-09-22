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
  /** Model for the judge's second reading of a note (src/note/judge.ts); defaults to NOTE_MODEL. */
  NOTE_JUDGE_MODEL?: string;
  /** Set at deploy time (git short sha) and folded into edge-cache keys. */
  BUILD?: string;
  /** Max paid note generations per UTC day outside of forced admin bakes. */
  DAILY_GENERATION_CAP?: string;
  /** Bearer token for the /admin/* endpoints (secret). Unset closes them. */
  ADMIN_TOKEN?: string;
  /** "1" once the Hebrew reviewer round is done: /he pages get indexed, listed in the sitemap and offered as hreflang
   *  alternates. Anything else keeps them Pre-Release (noindex, a notice on every page). */
  HE_PUBLIC?: string;
  /** Browser Rendering binding (wrangler.jsonc `browser`), used only by the card bake (src/og). Optional: without it the
   *  site serves the static social card. Typed as Fetcher so this file never imports puppeteer. */
  BROWSER?: Fetcher;
  /** Archive share cards rendered per card-bake run beyond the near days (default 10). Raise once CPU per card is measured. */
  OG_TRICKLE_PER_RUN?: string;

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
