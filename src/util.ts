/** Small helpers shared by the newsletter tick, the note bake and the card bake. */

/** Reject after `ms` so one slow call can never hold a cron run past its budget. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timed out after ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** 32-bit FNV-1a as eight lowercase hex characters: a cheap stable fingerprint for URLs and cache keys. */
export function fnv1a(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
