/**
 * The kinds a unit of the map can be. A fixed vocabulary shared by the prompt (the model may only choose from it),
 * the gate (anything else is rejected), the renderer and the i18n tables (every kind has a label in every language).
 * Dependency-free on purpose, so src/i18n and src/render can import it without pulling in the pipeline.
 */
export const MAP_KINDS = ["mishna", "reading", "question", "answer", "objection", "proof", "dispute", "case", "story", "digression", "ruling", "open"] as const;
export type MapKind = (typeof MAP_KINDS)[number];

export function isMapKind(x: unknown): x is MapKind {
  return typeof x === "string" && (MAP_KINDS as readonly string[]).includes(x);
}
