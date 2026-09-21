// Node loader hook so `import s from "./x.md"` gives the file's text under tsx, the same as wrangler's Text rule
// and the vitest plugin. Every script runs as `tsx --import ./scripts/md-loader.mjs scripts/<name>.ts`.
import { register } from "node:module";
register(new URL("./md-hooks.mjs", import.meta.url));
