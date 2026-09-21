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

const MAX_GENERATIONS_PER_RUN = 3;
const BACKFILL_DAYS = 7;
const AHEAD_DAYS = 2;

/** Dates to check, most urgent first: tomorrow, today, the day after, then the last week. */
export function bakeTargets(nowUtc: Date): Date[] {
  const targets: Date[] = [addDays(nowUtc, 1), nowUtc];
  for (let i = 2; i <= AHEAD_DAYS; i++) targets.push(addDays(nowUtc, i));
  for (let i = 1; i <= BACKFILL_DAYS; i++) targets.push(addDays(nowUtc, -i));
  return targets;
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
    const outcome: GenerateOutcome = await ensureNote(env, ref, { force: stale, countAgainstCap: true });
    generations++;
    if (outcome.status === "generated") say(`${label}: generated in ${outcome.attempts} attempt(s)`);
    else if (outcome.status === "failed") say(`${label}: FAILED ${outcome.reason} ${(outcome.problems ?? []).join(" | ")}`);
    else say(`${label}: ${outcome.status} ${"reason" in outcome ? outcome.reason : ""}`);
  }
  return { log };
}
