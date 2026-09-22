/**
 * Hebrew text with vowels, cantillation, maqaf and punctuation removed, one space between words. Shared by the
 * translation gate (translate.ts), the Hebrew judge (tjudge.ts) and the Hebrew screens (screenHe.ts); it lives apart
 * from translate.ts so the judge can verify spans without importing the module that calls it.
 */
export function normalizeHe(s: string): string {
  return s
    .normalize("NFC")
    .replace(/\p{Mn}/gu, "")
    .replace(/־/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
