/**
 * Nightly bake. Runs in UTC. Free-plan Workers get 10 ms of CPU per
 * invocation (waiting on Sefaria and Claude does not count), so each run
 * touches a small, fixed number of dapim; the on-visit self-heal in
 * src/index.ts covers anything left over.
 *
 * Notes are baked two days ahead: the newsletter (src/newsletter) sends at each
 * reader's local hour, and a reader in UTC+13 who asked for tomorrow's daf the
 * evening before needs it about 07:00 UTC, an hour after this runs.
 */
import type { Env } from "./types";
import { addDays, dafForDate, todayIn, ymd } from "./daf/schedule";
import { ensureNote, type GenerateOutcome } from "./note/generate";
import { getNote } from "./note/store";
import { hashPrompt } from "./note/prompt";
import { ENABLED_LANGS } from "./i18n/strings";
import { ensureTranslation, translationCurrent, type TranslatableLang } from "./note/translate";
import { getTranslation } from "./note/tstore";
import { ensureMap } from "./map/generate";
import { hashMapPrompt } from "./map/prompt";
import { getMap } from "./map/store";

const MAX_GENERATIONS_PER_RUN = 3;
/** Translations of the near days' notes, per run; they never fire from a page visit. */
const MAX_TRANSLATIONS_PER_RUN = 3;
/** Maps of the near days' pages, per run; like translations they never fire from a page visit. */
const MAX_MAPS_PER_RUN = 3;
const BACKFILL_DAYS = 7;
const AHEAD_DAYS = 2;

/** Dates to check, most urgent first: tomorrow, today, the day after, then the last week. */
export function bakeTargets(nowUtc: Date): Date[] {
  const targets: Date[] = [addDays(nowUtc, 1), nowUtc];
  for (let i = 2; i <= AHEAD_DAYS; i++) targets.push(addDays(nowUtc, i));
  for (let i = 1; i <= BACKFILL_DAYS; i++) targets.push(addDays(nowUtc, -i));
  return targets;
}

/** The near days only: tomorrow, today, the day after. The passes that never backfill (maps, translations) walk these. */
export function nearTargets(nowUtc: Date): Date[] {
  return bakeTargets(nowUtc).slice(0, AHEAD_DAYS + 1);
}

export async function runCron(env: Env, scheduledTime: number): Promise<{ log: string[] }> {
  const log: string[] = [];
  const nowUtc = todayIn("UTC", new Date(scheduledTime));
  let generations = 0;
  const say = (s: string) => { log.push(s); console.log(`[cron] ${s}`); };

  const current = hashPrompt();
  for (const [i, date] of bakeTargets(nowUtc).entries()) {
    if (generations >= MAX_GENERATIONS_PER_RUN) { say(`budget of ${MAX_GENERATIONS_PER_RUN} generations reached; stopping`); break; }
    const ref = dafForDate(date);
    const label = `${ref.tractate.name} ${ref.daf} (${ymd(date)})`;
    const existing = await getNote(env.DAF_KV, ref.tractate, ref.daf);
    // The near targets (tomorrow, today, the day after) are re-baked when their note predates the current
    // house style, so every rule Joe adds reaches the pages people actually read within a day. The backfill
    // targets only fill gaps; the deep archive is re-baked deliberately and rarely, because it costs ~$200.
    const stale = Boolean(existing && i <= AHEAD_DAYS && existing.promptVersion !== current);
    if (existing && !stale) { say(`${label}: note exists (current style)`); continue; }
    if (stale) say(`${label}: note is from style ${existing!.promptVersion}; re-baking under ${current}`);
    const outcome: GenerateOutcome = await ensureNote(env, ref, { force: stale, countAgainstCap: true, judge: "once" });
    generations++;
    if (outcome.status === "generated") say(`${label}: generated in ${outcome.attempts} attempt(s)${outcome.judged ? `; judge: ${outcome.judged.verdict} (${outcome.judged.questionStatus}, ${outcome.judged.reach})` : ""}`);
    else if (outcome.status === "failed") say(`${label}: FAILED ${outcome.reason} ${(outcome.problems ?? []).join(" | ")}`);
    else say(`${label}: ${outcome.status} ${"reason" in outcome ? outcome.reason : ""}`);
  }

  // The map of the page for the near days, before the translations: English readers see it, Hebrew is Pre-Release.
  // A map from an older style is re-drawn, as a note is; the archive is drawn deliberately (scripts/maps-backfill.ts).
  let maps = 0;
  const mapStyle = hashMapPrompt();
  for (const date of nearTargets(nowUtc)) {
    if (maps >= MAX_MAPS_PER_RUN) break;
    const ref = dafForDate(date);
    const label = `${ref.tractate.name} ${ref.daf} (${ymd(date)}) [map]`;
    const existing = await getMap(env.DAF_KV, ref.tractate, ref.daf);
    const stale = Boolean(existing && existing.promptVersion !== mapStyle);
    if (existing && !stale) { say(`${label}: exists (current style)`); continue; }
    if (stale) say(`${label}: map is from style ${existing!.promptVersion}; re-drawing under ${mapStyle}`);
    const outcome = await ensureMap(env, ref, { force: stale, countAgainstCap: true });
    maps++;
    if (outcome.status === "generated") say(`${label}: drawn in ${outcome.attempts} attempt(s), ${outcome.map.units.length} units`);
    else if (outcome.status === "failed") say(`${label}: FAILED ${outcome.reason} ${(outcome.problems ?? []).join(" | ")}`);
    else say(`${label}: ${outcome.status} ${"reason" in outcome ? outcome.reason : ""}`);
  }

  // The near days' notes in every enabled language. A translation is current only while it belongs to the note that
  // is stored now (its `of`) and to the current translation style; otherwise it is made again.
  let translations = 0;
  const langs = ENABLED_LANGS.filter((l): l is TranslatableLang => l !== "en");
  for (const [i, date] of bakeTargets(nowUtc).entries()) {
    if (i > AHEAD_DAYS || langs.length === 0) break;
    const ref = dafForDate(date);
    const note = await getNote(env.DAF_KV, ref.tractate, ref.daf);
    if (!note) continue;
    for (const lang of langs) {
      if (translations >= MAX_TRANSLATIONS_PER_RUN) break;
      const label = `${ref.tractate.name} ${ref.daf} (${ymd(date)}) [${lang}]`;
      const existing = await getTranslation(env.DAF_KV, lang, ref.tractate, ref.daf);
      if (translationCurrent(note, existing, lang)) { say(`${label}: translation exists (current)`); continue; }
      const outcome = await ensureTranslation(env, ref, lang, { force: true, countAgainstCap: true });
      translations++;
      if (outcome.status === "generated") say(`${label}: translated in ${outcome.attempts} attempt(s)`);
      else if (outcome.status === "failed") say(`${label}: FAILED ${outcome.reason} ${(outcome.problems ?? []).join(" | ")}`);
      else say(`${label}: ${outcome.status} ${"reason" in outcome ? outcome.reason : ""}`);
    }
  }
  return { log };
}
