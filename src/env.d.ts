declare module "*.md" {
  const text: string;
  export default text;
}
/** Wrangler's Data rule (wrangler.jsonc `rules`): a font file imports as its bytes. src/og/fonts.ts is the only importer. */
declare module "*.woff2" {
  const data: ArrayBuffer;
  export default data;
}
