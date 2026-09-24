/**
 * The campaign tag: one word naming where a subscriber came from (a paid link), never who they are.
 *
 * It arrives as `?src=` on a landing URL, is kept in the browser's sessionStorage by the page chrome, is posted
 * as a hidden form field, rides inside the signed confirm token, and lands in `subscribers.source` when the
 * reader clicks the confirmation link. Nothing about it reaches Google: no Google tag, no click id.
 */
export const SOURCE_RE = /^[a-z0-9-]{1,32}$/;

/** A well-formed tag, or null. Anything that is not a short lower-case word is dropped, never rewritten. */
export function parseSource(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  return SOURCE_RE.test(raw) ? raw : null;
}
