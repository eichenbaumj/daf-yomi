/**
 * The card bake: which cards to draw, and drawing them. Runs on its own cron (20 minutes after each note bake,
 * so a browser hang can never touch the notes), and from POST /admin/og/bake. Never from a page view.
 *
 * Order of work per run: the near days (tomorrow, today, the day after, yesterday), then a trickle through
 * the archive from a KV cursor (`ogcursor:v1`, the next day-in-cycle to look at), OG_TRICKLE_PER_RUN cards
 * at most. The cursor is written before the chunk is drawn, so a killed run moves on instead of sticking.
 */
import type { Env } from "../types";
import { addDays, cycleStartDate, dafForDate, dateForDaf, todayIn, ymd, type DafRef } from "../daf/schedule";
import { CYCLE_LENGTH } from "../daf/tractates";
import { hebrewDateL, dafLabelL, longDateL, strings } from "../i18n/format";
import type { Lang } from "../i18n/strings";
import { getNote, type DafNote } from "../note/store";
import { CARD_VERSION, cardToken, type CardModel } from "./card";
import { BrowserError, type CardRenderer } from "./browser";
import { OG_CURSOR_KEY, cardNeedsRender, getCardMeta, putCard, type CardMeta } from "./store";

export const CARD_CRON = "20 6,18 * * *";
/** Days from today whose cards are checked every run, most urgent first. */
export const NEAR_OFFSETS = [1, 0, 2, -1] as const;
const DEFAULT_TRICKLE = 10;
/** Dapim examined per run in the trickle before giving up on finding work (a scan is two KV reads). */
const SCAN_FACTOR = 4;

export interface CardTarget { ref: DafRef; date: Date }

export type CardOutcome =
  | { daf: string; status: "rendered"; token: string; bytes: number; ms: number }
  | { daf: string; status: "current"; token: string }
  | { daf: string; status: "no-note" }
  | { daf: string; status: "failed"; reason: string; kind?: "budget" | "rate" | "other" };

export function cardModelFor(env: Env, ref: DafRef, date: Date, note: DafNote, lang: Lang = "en"): CardModel {
  const S = strings(lang);
  return {
    lang,
    label: dafLabelL(lang, ref.tractate, ref.daf),
    heTitle: ref.tractate.heTitle,
    dateWords: longDateL(lang, date),
    hebrewDateWords: hebrewDateL(lang, date),
    question: note.question,
    dayInCycle: ref.dayInCycle,
    cycleLength: CYCLE_LENGTH,
    wordmark: S.cardWordmark,
    aiChip: S.cardAiChip,
    aiLine: S.cardAiLine,
    site: env.CANONICAL_HOST || "daf-yomi.dev",
  };
}

export function targetFor(ref: DafRef): CardTarget {
  return { ref, date: dateForDaf(ref.tractate, ref.daf, ref.cycle) };
}

const dafId = (ref: DafRef) => `${ref.tractate.slug}/${ref.daf}`;

/** Draw one card if it is missing or stale (or `force`), store it, and say what happened. */
export async function bakeCard(env: Env, target: CardTarget, note: DafNote, renderer: CardRenderer, opts: { force?: boolean; now?: Date } = {}): Promise<CardOutcome> {
  const { ref, date } = target;
  const id = dafId(ref);
  const existing = await getCardMeta(env.DAF_KV, ref.tractate, ref.daf);
  if (!opts.force && existing && !cardNeedsRender(note, existing, ref.cycle)) return { daf: id, status: "current", token: existing.token };
  const t0 = Date.now();
  const png = await renderer.render(cardModelFor(env, ref, date, note));
  const renderedAt = (opts.now ?? new Date()).toISOString();
  const meta: CardMeta = { of: note.generatedAt, cv: CARD_VERSION, cycle: ref.cycle, token: cardToken({ generatedAt: note.generatedAt, renderedAt, cycle: ref.cycle }), bytes: png.byteLength, renderedAt };
  await putCard(env.DAF_KV, ref.tractate, ref.daf, png, meta);
  return { daf: id, status: "rendered", token: meta.token, bytes: png.byteLength, ms: Date.now() - t0 };
}

/**
 * Draw a list of cards with one renderer. Duplicates are dropped (KV allows one write per key per second).
 * A browser budget or rate failure stops the batch: the rest are reported as failed with that kind.
 */
export async function bakeCards(env: Env, targets: CardTarget[], renderer: CardRenderer, opts: { force?: boolean; now?: Date } = {}): Promise<CardOutcome[]> {
  const seen = new Set<string>();
  const out: CardOutcome[] = [];
  let stop: BrowserError | null = null;
  for (const target of targets) {
    const id = dafId(target.ref);
    if (seen.has(id)) continue;
    seen.add(id);
    if (stop) { out.push({ daf: id, status: "failed", reason: stop.message, kind: stop.kind }); continue; }
    const note = await getNote(env.DAF_KV, target.ref.tractate, target.ref.daf);
    if (!note) { out.push({ daf: id, status: "no-note" }); continue; }
    try {
      out.push(await bakeCard(env, target, note, renderer, opts));
    } catch (e) {
      const kind = e instanceof BrowserError ? e.kind : "other";
      out.push({ daf: id, status: "failed", reason: e instanceof Error ? e.message : String(e), kind });
      if (e instanceof BrowserError && e.kind !== "other") stop = e;
    }
  }
  return out;
}

export interface CardBakeDeps {
  /** Made only when there is work, so a run with nothing to draw never launches a browser. */
  makeRenderer?: () => CardRenderer;
  now?: Date;
}

/** Archive dapim whose card is missing or stale, starting at the cursor; writes the cursor before returning. */
export async function trickleTargets(env: Env, cycle: number, want: number, log: (s: string) => void): Promise<CardTarget[]> {
  if (want <= 0) return [];
  const start = cycleStartDate(cycle);
  const raw = Number((await env.DAF_KV.get(OG_CURSOR_KEY)) ?? 1);
  let i = Number.isFinite(raw) && raw >= 1 && raw <= CYCLE_LENGTH ? Math.floor(raw) : 1;
  const found: CardTarget[] = [];
  let scanned = 0;
  const limit = Math.max(want * SCAN_FACTOR, 30);
  while (found.length < want && scanned < limit) {
    const date = addDays(start, i - 1);
    const ref = dafForDate(date);
    scanned++;
    i = i >= CYCLE_LENGTH ? 1 : i + 1;
    const note = await getNote(env.DAF_KV, ref.tractate, ref.daf);
    if (!note) continue;
    const meta = await getCardMeta(env.DAF_KV, ref.tractate, ref.daf);
    if (cardNeedsRender(note, meta, cycle)) found.push({ ref, date });
  }
  await env.DAF_KV.put(OG_CURSOR_KEY, String(i));
  log(`trickle: scanned ${scanned}, ${found.length} to draw, cursor now day ${i}`);
  return found;
}

export async function runCardBake(env: Env, scheduledTime: number, deps: CardBakeDeps = {}): Promise<{ log: string[]; outcomes: CardOutcome[] }> {
  const log: string[] = [];
  const say = (s: string) => { log.push(s); console.log(`[cards] ${s}`); };
  const now = deps.now ?? new Date(scheduledTime);
  const nowUtc = todayIn("UTC", now);
  const near: CardTarget[] = NEAR_OFFSETS.map((o) => { const date = addDays(nowUtc, o); return { ref: dafForDate(date), date }; });
  const cycle = near[1]!.ref.cycle;
  const trickle = Number(env.OG_TRICKLE_PER_RUN ?? DEFAULT_TRICKLE);
  const targets = [...near, ...(await trickleTargets(env, cycle, Number.isFinite(trickle) ? trickle : DEFAULT_TRICKLE, say))];

  // Decide what needs drawing before touching the browser: most runs find the near cards current.
  const work: CardTarget[] = [];
  const outcomes: CardOutcome[] = [];
  for (const t of targets) {
    const id = dafId(t.ref);
    const note = await getNote(env.DAF_KV, t.ref.tractate, t.ref.daf);
    if (!note) { outcomes.push({ daf: id, status: "no-note" }); say(`${id} (${ymd(t.date)}): no note`); continue; }
    const meta = await getCardMeta(env.DAF_KV, t.ref.tractate, t.ref.daf);
    if (!cardNeedsRender(note, meta, t.ref.cycle)) { outcomes.push({ daf: id, status: "current", token: meta!.token }); continue; }
    work.push(t);
  }
  if (work.length === 0) { say(`nothing to draw (${targets.length} checked)`); return { log, outcomes }; }
  if (!deps.makeRenderer) { say(`${work.length} card(s) wanted but no browser binding; skipping`); return { log, outcomes }; }
  const renderer = deps.makeRenderer();
  try {
    const drawn = await bakeCards(env, work, renderer, { now });
    for (const o of drawn) {
      outcomes.push(o);
      if (o.status === "rendered") say(`${o.daf}: drawn ${o.bytes} bytes in ${o.ms} ms, token ${o.token}`);
      else if (o.status === "failed") say(`${o.daf}: FAILED (${o.kind}) ${o.reason}`);
      else say(`${o.daf}: ${o.status}`);
    }
  } finally {
    await renderer.close();
  }
  return { log, outcomes };
}
