/** Which dapim a script works on: --window N (today ± N), --dapim slug/daf[,…], --all. They add up. */
import { TRACTATES, tractateBySlug, type Tractate } from "../../src/daf/tractates";
import { addDays, dafForDate, dateForDaf, todayIn, type DafRef } from "../../src/daf/schedule";

export const keyOf = (ref: DafRef) => `${ref.tractate.slug}/${ref.daf}`;
export const today = todayIn("UTC");
export const cycle = dafForDate(today).cycle;
export const refFor = (t: Tractate, daf: number): DafRef => dafForDate(dateForDaf(t, daf, cycle));

export function refForKey(key: string): DafRef {
  const [slug, n] = key.split("/");
  const t = tractateBySlug(slug ?? "");
  if (!t || !n) throw new Error(`unknown daf ${key}`);
  return refFor(t, Number(n));
}

export function parseTargets(opt: (k: string) => string | undefined, flag: (k: string) => boolean): Map<string, DafRef> {
  const targets = new Map<string, DafRef>();
  const add = (ref: DafRef) => targets.set(keyOf(ref), ref);
  const window = Number(opt("window") ?? NaN);
  if (Number.isFinite(window)) for (let d = -window; d <= window; d++) add(dafForDate(addDays(today, d)));
  for (const x of (opt("dapim") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) add(refForKey(x));
  if (flag("all")) for (const t of TRACTATES) for (let d = t.firstDaf; d <= t.lastDaf; d++) add(refFor(t, d));
  return targets;
}

/** Keys within `days` of today: the cron owns these; archive work leaves them alone. */
export function nearKeys(days: number): Set<string> {
  const out = new Set<string>();
  for (let d = -days; d <= days; d++) out.add(keyOf(dafForDate(addDays(today, d))));
  return out;
}
