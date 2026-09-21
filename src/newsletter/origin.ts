import type { Env } from "../types";

/** The public origin every email link points at. Never a request's own host (www or workers.dev would 308 a form POST). */
export function siteOrigin(env: Env): string {
  return env.CANONICAL_HOST ? `https://${env.CANONICAL_HOST}` : "http://localhost:8787";
}
