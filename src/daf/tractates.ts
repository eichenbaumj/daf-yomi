import data from "../../data/tractates.json";

export interface Chapter { n: number; title: string; heTitle: string; startDaf: string; endDaf: string }
export interface Tractate {
  hebcalName: string;
  sefariaTitle: string;
  /** Display name, e.g. "Bekhorot", "Shekalim", "Middot". */
  name: string;
  slug: string;
  heTitle: string;
  seder: string;
  sederHe: string;
  order: number;
  firstDaf: number;
  lastDaf: number;
  days: number;
  /** "talmud": Sefaria ref is `{sefariaTitle} {n}a`; "calendar": ask Sefaria's calendar for the day's ref. */
  refMode: "talmud" | "calendar";
  /** Side the tractate ends on; when "a", the last daf has no b side to fetch. */
  lastAmud: "a" | "b";
  shortDesc: string;
  /** Sefaria's own Hebrew one-liner (heShortDesc), for the Hebrew pages. */
  heShortDesc?: string;
  description: string;
  chapters: Chapter[];
  introNodes: string[];
}

export const CYCLE_LENGTH: number = data.cycleLength;
export const TRACTATES: Tractate[] = (data.tractates as Tractate[]).slice().sort((a, b) => a.order - b.order);

const bySlug = new Map(TRACTATES.map((t) => [t.slug, t]));
const byHebcal = new Map(TRACTATES.map((t) => [t.hebcalName, t]));

export function tractateBySlug(slug: string): Tractate | undefined {
  return bySlug.get(slug.toLowerCase());
}
export function tractateByHebcalName(name: string): Tractate {
  const t = byHebcal.get(name);
  if (!t) throw new Error(`Unknown hebcal tractate name: ${name}`);
  return t;
}
export function isValidDaf(t: Tractate, daf: number): boolean {
  return Number.isInteger(daf) && daf >= t.firstDaf && daf <= t.lastDaf;
}
export function dafPath(t: Tractate, daf: number): string {
  return `/${t.slug}/${daf}`;
}
export function dafLabel(t: Tractate, daf: number): string {
  return `${t.name} ${daf}`;
}
/** Steinsaltz introduction ref on Sefaria, if Sefaria carries one for this tractate. */
export function introRef(t: Tractate): string | null {
  const title = `Introduction to ${t.sefariaTitle}`;
  return t.introNodes.includes(title) ? `Introductions to the Babylonian Talmud, ${t.sefariaTitle}, ${title}` : null;
}
