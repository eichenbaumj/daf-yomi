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
}
