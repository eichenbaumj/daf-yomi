/**
 * KV for the map of the page: `map:v1:<slug>:<daf>`. The map is its own artifact, independent of the note: a note
 * re-bake never touches it and a map re-draw never touches the note. The Hebrew map (src/map/tstore.ts, later)
 * binds to the English map's `generatedAt`, as the Hebrew note binds to the English note's.
 */
import type { Tractate } from "../daf/tractates";
import type { MapKind } from "./kinds";

export interface MapUnit {
  /** DOM ids of the first and last segment, inclusive: "a-1" … "b-24". A unit may run from the a side into the b side. */
  from: string;
  to: string;
  kind: MapKind;
  title: string;
  gloss: string;
}

export interface DafMap {
  units: MapUnit[];
  shape: string;
  model: string;
  /** hashMapPrompt() at write time. */
  promptVersion: string;
  /** ISO; the identity every downstream artifact (the Hebrew map) binds to. */
  generatedAt: string;
  /** Sefaria urlRefs the map was drawn from, e.g. ["Bekhorot.4a", "Bekhorot.4b"]. */
  sources: string[];
  /** Segments per section in page order, e.g. [13, 24]; the renderer hides a map whose ids no longer fit the text. */
  segmentCounts: number[];
  usage?: { inputTokens: number; outputTokens: number; attempts: number; estUsd: number };
}

export const mapKey = (t: Tractate, daf: number) => `map:v1:${t.slug}:${daf}`;

export async function getMap(kv: KVNamespace, t: Tractate, daf: number): Promise<DafMap | null> {
  return (await kv.get(mapKey(t, daf), "json")) as DafMap | null;
}

export async function putMap(kv: KVNamespace, t: Tractate, daf: number, map: DafMap): Promise<void> {
  await kv.put(mapKey(t, daf), JSON.stringify(map));
}
