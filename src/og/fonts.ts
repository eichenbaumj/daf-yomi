/**
 * The card fonts as bytes, from the Worker bundle (wrangler's Data rule; see scripts/og-fonts.ts for where they
 * come from). This is the only module that imports the woff2 files, so tests and scripts never need a loader
 * for them: they hand src/og/card.ts a FontFace[] of their own.
 */
import manifest from "./fonts/manifest.json";
import frankHebrew from "./fonts/frank-ruhl-libre-normal-hebrew.woff2";
import ssItalicLatinExt from "./fonts/source-serif-4-italic-latin-ext.woff2";
import ssItalicLatin from "./fonts/source-serif-4-italic-latin.woff2";
import ssNormalLatinExt from "./fonts/source-serif-4-normal-latin-ext.woff2";
import ssNormalLatin from "./fonts/source-serif-4-normal-latin.woff2";
import { facesFrom, type FontFace } from "./card";

const BYTES: Record<string, ArrayBuffer> = {
  "frank-ruhl-libre-normal-hebrew.woff2": frankHebrew,
  "source-serif-4-italic-latin-ext.woff2": ssItalicLatinExt,
  "source-serif-4-italic-latin.woff2": ssItalicLatin,
  "source-serif-4-normal-latin-ext.woff2": ssNormalLatinExt,
  "source-serif-4-normal-latin.woff2": ssNormalLatin,
};

let cached: FontFace[] | null = null;
/** Base64 is computed once per isolate (about 140 KB of fonts, 185 KB encoded). */
export function cardFonts(): FontFace[] {
  return (cached ??= facesFrom(manifest, BYTES));
}
