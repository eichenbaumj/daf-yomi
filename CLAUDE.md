# Today's Daf (daf-yomi)

Standalone, public, free Daf Yomi site at **https://daf-yomi.dev**. Independent of the gizmo-warehouse code (a warehouse post may
link here later). Joe's decisions, 2026-09-20: AI-written note, fully transparent; Cloudflare Workers +
cron; permalinks for every daf.

## Non-negotiables

- **Every text comes from Sefaria.** Nothing is typed in, nothing is paraphrased as text. If Sefaria is
  down, the page says so; no fallback text.
- **The note is labelled as AI every time**, above the words, in the RSS feed, and in the API. Never
  soften the label. Never let the note cite Rashi/Tosafot/later authorities, state halacha as practice,
  or quote something not in the daf. `src/note/grounding.ts` enforces this; tests cover it.
- **Attribution on every page**: William Davidson Talmud, Koren Noé, Steinsaltz, Sefaria, CC BY-NC 4.0.
  Non-commercial forever.
- **No em dashes, no AI tells** in any rendered prose (`test/render.test.ts` checks the chrome; the
  grounding check covers notes).
- Joe's voice on `/about`: first person, plain, dry. Not corporate.
- **Design direction (Joe, 2026-09-20):** warm parchment, brown ink, oxblood and gold; "the office of a great old
  Torah scholar," human and lived in, exciting for a day of Torah. White/clinical surfaces were rejected. Assume
  the reader has never heard of Rabbi Steinsaltz, Sefaria, or a Seder: gloss every such name on first appearance.

## Layout

`src/daf` schedule + tractate table · `src/sefaria` fetch + sanitize · `src/note` prompt, grounding,
generate, KV store · `src/render` HTML · `src/index.ts` routes · `src/cron.ts` nightly bake ·
`prompts/daf-note.md` the house style (bump `PROMPT_VERSION` in `src/note/prompt.ts` when it changes
enough to re-bake) · `scripts/` bake table, verify cycle, try notes, backfill, check links ·
`data/tractates.json` generated, commit it.

## Working here

- `npm test` and `npm run typecheck` before any deploy. `npm run verify:cycle -- --sample 80` after
  touching the schedule or the table.
- Free-plan Workers: 10 ms CPU per invocation. Rendering is cached at the edge; the cron bakes at most
  three dapim per run. If CPU limits ever bite, Workers Paid ($5/mo) is the fix, not a rewrite.
- Push ≠ deploy here either: `npm run deploy` is the deploy. Verify the live URL after.
- KV keys: `text:v1:<urlRef>` (30 d), `ref:v1:<slug>:<daf>`, `note:v1:<slug>:<daf>`, `notelock:*`.
- Style iteration is a review round with Joe: `npm run bake:note -- <targets>` on 5 varied dapim, edit
  `prompts/daf-note.md`, repeat. Re-bake the archive with `npm run backfill -- --force`.
