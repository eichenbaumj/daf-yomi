export interface Env {
  DAF_KV: KVNamespace;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  SITE_NAME: string;
  SITE_TAGLINE: string;
  DEFAULT_TIMEZONE: string;
  NOTE_MODEL: string;
}
