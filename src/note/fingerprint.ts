/** A cheap, stable fingerprint of a prompt file, so a wording change is visible in everything stored under it. */
export function fingerprint(version: string, text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `${version}-${h.toString(16)}`;
}
