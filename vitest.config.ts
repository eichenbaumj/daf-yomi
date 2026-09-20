import { defineConfig, type Plugin } from "vitest/config";
import { readFileSync } from "node:fs";

/** Mirror wrangler's Text rule: `import s from "./x.md"` gives the file contents. */
const markdownAsText: Plugin = {
  name: "markdown-as-text",
  enforce: "pre",
  load(id) {
    if (id.endsWith(".md")) return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
    return null;
  },
};

export default defineConfig({
  plugins: [markdownAsText],
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
