/**
 * Pure scheduling for the hourly tick: who is due, for which daf, and what
 * to do when the note is not written yet. No I/O, so the whole state machine
 * is unit-tested against fixed clocks.
 *
 * A subscriber picks an hour in their own time zone and an edition: today's
 * daf at that hour, or tomorrow's daf the evening before. A send is due when
 * the local hour has just reached the chosen hour, or up to CATCHUP_HOURS
 * later if no delivery row exists yet (DST gaps, missed ticks, deferrals
 * while the note was still being written).
 */
import { addDays, parseYmd, ymd, dafForDate, type DafRef } from "../daf/schedule";
import type { DeliveryRow, Edition, SubscriberRow, Variant } from "./db";

export const MAX_ATTEMPTS = 5;
export const BATCH_SIZE = 50;

export interface LocalClock { ymd: string; hour: number; date: Date }

const clockFormatters = new Map<string, Intl.DateTimeFormat>();
function clockFormatter(tz: string): Intl.DateTimeFormat {
  let f = clockFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    clockFormatters.set(tz, f);
  }
  return f;
}

/** Local civil date and hour (0-23) in an IANA zone; unknown zones fall back to UTC, as todayIn does. */
export function localClock(tz: string, now: Date): LocalClock {
  let parts: Intl.DateTimeFormatPart[];
  try { parts = clockFormatter(tz).formatToParts(now); } catch { parts = clockFormatter("UTC").formatToParts(now); }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const date = new Date(get("year"), get("month") - 1, get("day"));
  return { ymd: ymd(date), hour: get("hour") % 24, date };
}

export type ActionKind = "send" | "defer" | "hold" | "ensure-then-send";
export interface PlanAction {
  sub: SubscriberRow;
  /** Local civil date on which the email goes out. */
  sendDate: Date;
  /** Civil date of the daf being sent (sendDate, or +1 for the evening-before edition). */
  editionDate: string;
  /** Hours past the chosen hour (0 = on time). */
  slot: number;
  kind: ActionKind;
  /** An existing reserved row being retried. */
  retry: boolean;
}
export interface PlanInput {
  now: Date;
  catchupHours: number;
  subscribers: SubscriberRow[];
  deliveries: DeliveryRow[];
  /** true = note exists, false = missing. */
  notePresent: (editionDate: string) => boolean;
  /** Shabbat/Yom Tov test for the hold preference; receives the send date. */
  isRestDay: (date: Date, israel: boolean) => boolean;
  isIsraelTz: (tz: string) => boolean;
  clock?: (tz: string, now: Date) => LocalClock;
}

export function editionDateFor(sendDate: Date, edition: Edition): string {
  return ymd(edition === "tomorrow" ? addDays(sendDate, 1) : sendDate);
}

export function planTick(input: PlanInput): PlanAction[] {
  const clock = input.clock ?? localClock;
  const clocks = new Map<string, LocalClock>();
  const byKey = new Map<string, DeliveryRow>();
  for (const d of input.deliveries) byKey.set(`${d.subscriber_id}:${d.edition_date}`, d);
  const actions: PlanAction[] = [];

  for (const sub of input.subscribers) {
    if (sub.status !== "active" || !sub.tz) continue;
    let c = clocks.get(sub.tz);
    if (!c) { c = clock(sub.tz, input.now); clocks.set(sub.tz, c); }
    const slot = (c.hour - sub.hour + 24) % 24;
    if (slot > input.catchupHours) continue;
    // Catching up past local midnight (hour 23 chosen, tick at 01:00) belongs to yesterday's send.
    const sendDate = slot > c.hour ? addDays(c.date, -1) : c.date;
    const editionDate = editionDateFor(sendDate, sub.edition);
    const existing = byKey.get(`${sub.id}:${editionDate}`);
    if (existing) {
      if (existing.status !== "reserved" || existing.attempts >= MAX_ATTEMPTS) continue;
      actions.push({ sub, sendDate, editionDate, slot, kind: "send", retry: true });
      continue;
    }
    if (sub.hold_shabbat && input.isRestDay(sendDate, input.isIsraelTz(sub.tz))) {
      actions.push({ sub, sendDate, editionDate, slot, kind: "hold", retry: false });
      continue;
    }
    if (input.notePresent(editionDate)) actions.push({ sub, sendDate, editionDate, slot, kind: "send", retry: false });
    else if (slot < input.catchupHours) actions.push({ sub, sendDate, editionDate, slot, kind: "defer", retry: false });
    else actions.push({ sub, sendDate, editionDate, slot, kind: "ensure-then-send", retry: false });
  }
  return actions;
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Provider idempotency key for one chunk: the same rows retried produce the same key. */
export function batchKey(editionDate: string, variant: Variant, firstId: number, n: number): string {
  return `daf:${editionDate}:${variant}:${firstId}:${n}`;
}

export interface HeldDaf { date: Date; ref: DafRef }

/**
 * The dapim a hold-Shabbat reader missed: walk back over the consecutive rest
 * days before this send date and name the daf each held send would have carried.
 */
export function heldDafimFor(sub: SubscriberRow, sendDate: Date, israel: boolean, isRestDay: (d: Date, il: boolean) => boolean): HeldDaf[] {
  const held: HeldDaf[] = [];
  for (let d = addDays(sendDate, -1), i = 0; i < 4 && isRestDay(d, israel); d = addDays(d, -1), i++) {
    const dafDate = sub.edition === "tomorrow" ? addDays(d, 1) : d;
    held.unshift({ date: dafDate, ref: dafForDate(dafDate) });
  }
  return held;
}

export function dafDateOf(editionDate: string): Date {
  const d = parseYmd(editionDate);
  if (!d) throw new Error(`bad edition date ${editionDate}`);
  return d;
}
