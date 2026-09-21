/**
 * The only module that speaks SQL. Everything else works against the
 * NewsletterDb interface, so tests run on an in-memory fake and the hourly
 * tick can be reasoned about as a fixed number of statements.
 *
 * D1 on the free plan allows 50 queries per invocation (each member of a
 * batch counts), 100 bound parameters per statement and 100 KB per statement.
 * Multi-row writes therefore go through json_each() over one JSON parameter,
 * never a loop of single-row statements.
 */

export type SubscriberStatus = "active" | "unsubscribed" | "bounced" | "complained";
export type Edition = "today" | "tomorrow";
export type DeliveryStatus = "reserved" | "sent" | "failed" | "held";
export type Variant = "full" | "nonote";

export interface SubscriberRow {
  id: number;
  email: string;
  email_hash: string;
  tz: string | null;
  hour: number;
  edition: Edition;
  hold_shabbat: 0 | 1;
  status: SubscriberStatus;
  unsub_token: string;
  consent_version: string;
  created_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  updated_at: string;
}
export interface DeliveryRow {
  subscriber_id: number;
  edition_date: string;
  variant: string;
  status: DeliveryStatus;
  attempts: number;
  batch_key: string | null;
  provider_id: string | null;
  last_error: string | null;
  updated_at: string;
}
export interface EditionRow {
  edition_date: string;
  variant: Variant;
  slug: string;
  daf: number;
  note_present: 0 | 1;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  rendered_at: string;
}
export interface SendRunRow {
  tick: string;
  due: number;
  sent: number;
  deferred: number;
  held: number;
  failed: number;
  ms: number;
  log: string;
}
export interface NewSubscriber {
  email: string;
  email_hash: string;
  tz: string;
  hour: number;
  edition: Edition;
  hold_shabbat: 0 | 1;
  consent_version: string;
  unsub_token: string;
}
export interface Prefs { tz: string; hour: number; edition: Edition; hold_shabbat: 0 | 1 }
export interface EventRow {
  provider_event_id: string;
  type: string;
  email_hash: string | null;
  subscriber_id: number | null;
  received_at: string;
  payload: string | null;
}

export interface NewsletterDb {
  // --- hourly tick ---
  activeTimezones(): Promise<string[]>;
  /** Active subscribers whose (zone, chosen hour) is one of these pairs: the only rows a tick needs to see. */
  activeSubscribersDue(pairs: { tz: string; hour: number }[]): Promise<SubscriberRow[]>;
  /** Delivery rows for these edition dates, restricted to active subscribers in these zones. */
  deliveriesFor(editionDates: string[], tzs: string[]): Promise<DeliveryRow[]>;
  editionsFor(editionDates: string[]): Promise<EditionRow[]>;
  putEdition(row: EditionRow): Promise<void>;
  reserve(editionDate: string, rows: { subscriber_id: number; variant: Variant; status: "reserved" | "held" }[], now: string): Promise<void>;
  assignBatch(batchKey: string, editionDate: string, subscriberIds: number[], now: string): Promise<void>;
  markSent(editionDate: string, sent: { subscriber_id: number; provider_id: string }[], now: string): Promise<void>;
  /** attempts+1 on every reserved row of the batch; status becomes 'failed' once attempts reach failAt. */
  markAttempt(batchKey: string, error: string, failAt: number, now: string): Promise<void>;
  /** Reserved rows for edition dates before this one are never sent late; returns how many were failed. */
  failStale(beforeEditionDate: string, now: string): Promise<number>;
  recordRun(run: SendRunRow): Promise<void>;
  // --- readers ---
  findByToken(token: string): Promise<SubscriberRow | null>;
  /** Tombstones the address and zone; returns the row as it was, or null when the token is unknown. Idempotent. */
  unsubscribe(token: string, now: string): Promise<SubscriberRow | null>;
  updatePrefs(token: string, prefs: Prefs, now: string): Promise<boolean>;
  // --- opt-in ---
  isSuppressed(emailHash: string): Promise<boolean>;
  findByEmailHash(emailHash: string): Promise<SubscriberRow | null>;
  /** Inserts, or revives the row that carries this address's hash (keeping its unsubscribe token). */
  upsertConfirmed(sub: NewSubscriber, now: string): Promise<SubscriberRow>;
  // --- provider events ---
  /** False when the provider event id was seen before. */
  recordEvent(ev: EventRow): Promise<boolean>;
  markBounced(emailHash: string, now: string): Promise<number>;
  markComplained(emailHash: string, now: string): Promise<number>;
  addSuppression(emailHash: string, reason: string, now: string): Promise<void>;
  // --- admin ---
  countByStatus(): Promise<Record<string, number>>;
  activeCount(): Promise<number>;
  recentRuns(limit: number): Promise<SendRunRow[]>;
  deliveryCounts(editionDates: string[]): Promise<{ edition_date: string; status: string; n: number }[]>;
  deleteEditions(editionDate: string): Promise<number>;
  /** Drops send_runs older than 90 days and editions/deliveries older than 60. */
  housekeeping(now: string): Promise<void>;
  /** Statements issued so far in this invocation (D1 free plan: 50). */
  statementCount(): number;
}

const WARN_AT = 30;
const THROW_AT = 45;

export function d1NewsletterDb(d1: D1Database): NewsletterDb {
  let count = 0;
  const tick = (n = 1) => {
    count += n;
    if (count > THROW_AT) throw new Error(`newsletter db: ${count} statements in one invocation (D1 free plan allows 50)`);
    if (count > WARN_AT) console.warn(`[newsletter] ${count} D1 statements in one invocation`);
  };
  const q = (sql: string, ...binds: unknown[]) => d1.prepare(sql).bind(...binds);
  const all = async <T>(sql: string, ...binds: unknown[]): Promise<T[]> => { tick(); return (await q(sql, ...binds).all<T>()).results; };
  const first = async <T>(sql: string, ...binds: unknown[]): Promise<T | null> => { tick(); return q(sql, ...binds).first<T>(); };
  const run = async (sql: string, ...binds: unknown[]): Promise<number> => { tick(); const r = await q(sql, ...binds).run(); return r.meta.changes ?? 0; };
  const j = (v: unknown) => JSON.stringify(v);

  return {
    activeTimezones: () => all<{ tz: string }>(`SELECT DISTINCT tz FROM subscribers WHERE status = 'active' AND tz IS NOT NULL`).then((r) => r.map((x) => x.tz)),
    activeSubscribersDue: (pairs) => pairs.length === 0 ? Promise.resolve([]) : all<SubscriberRow>(
      `SELECT s.* FROM subscribers s WHERE s.status = 'active'
         AND EXISTS (SELECT 1 FROM json_each(?1) p WHERE json_extract(p.value, '$.tz') = s.tz AND json_extract(p.value, '$.h') = s.hour)
       ORDER BY s.id`, j(pairs.map((p) => ({ tz: p.tz, h: p.hour })))),
    deliveriesFor: (dates, tzs) => all<DeliveryRow>(
      `SELECT d.* FROM deliveries d JOIN subscribers s ON s.id = d.subscriber_id
       WHERE d.edition_date IN (SELECT value FROM json_each(?1)) AND s.status = 'active' AND s.tz IN (SELECT value FROM json_each(?2))`, j(dates), j(tzs)),
    editionsFor: (dates) => all<EditionRow>(`SELECT * FROM editions WHERE edition_date IN (SELECT value FROM json_each(?1))`, j(dates)),
    putEdition: async (e) => { await run(
      `INSERT OR REPLACE INTO editions (edition_date, variant, slug, daf, note_present, subject, preheader, html, text, rendered_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
      e.edition_date, e.variant, e.slug, e.daf, e.note_present, e.subject, e.preheader, e.html, e.text, e.rendered_at); },
    reserve: async (editionDate, rows, now) => { if (!rows.length) return; await run(
      `INSERT OR IGNORE INTO deliveries (subscriber_id, edition_date, variant, status, attempts, updated_at)
       SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.v'), json_extract(value, '$.s'), 0, ?2 FROM json_each(?3)`,
      editionDate, now, j(rows.map((r) => ({ id: r.subscriber_id, v: r.variant, s: r.status })))); },
    assignBatch: async (batchKey, editionDate, ids, now) => { await run(
      `UPDATE deliveries SET batch_key = ?1, updated_at = ?2 WHERE edition_date = ?3 AND status = 'reserved' AND subscriber_id IN (SELECT value FROM json_each(?4))`,
      batchKey, now, editionDate, j(ids)); },
    markSent: async (editionDate, sent, now) => { if (!sent.length) return; await run(
      `UPDATE deliveries SET status = 'sent', attempts = attempts + 1, last_error = NULL, updated_at = ?2,
         provider_id = (SELECT json_extract(m.value, '$.p') FROM json_each(?1) m WHERE json_extract(m.value, '$.s') = deliveries.subscriber_id)
       WHERE edition_date = ?3 AND subscriber_id IN (SELECT json_extract(value, '$.s') FROM json_each(?1))`,
      j(sent.map((s) => ({ s: s.subscriber_id, p: s.provider_id }))), now, editionDate); },
    markAttempt: async (batchKey, error, failAt, now) => { await run(
      `UPDATE deliveries SET attempts = attempts + 1, last_error = ?2, updated_at = ?3,
         status = CASE WHEN attempts + 1 >= ?4 THEN 'failed' ELSE status END
       WHERE batch_key = ?1 AND status = 'reserved'`, batchKey, error.slice(0, 500), now, failAt); },
    failStale: (before, now) => run(`UPDATE deliveries SET status = 'failed', last_error = 'stale: edition date passed', updated_at = ?2 WHERE status = 'reserved' AND edition_date < ?1`, before, now),
    recordRun: async (r) => { await run(
      `INSERT OR REPLACE INTO send_runs (tick, due, sent, deferred, held, failed, ms, log) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
      r.tick, r.due, r.sent, r.deferred, r.held, r.failed, r.ms, r.log); },

    findByToken: (token) => first<SubscriberRow>(`SELECT * FROM subscribers WHERE unsub_token = ?1`, token),
    unsubscribe: async (token, now) => {
      const row = await first<SubscriberRow>(`SELECT * FROM subscribers WHERE unsub_token = ?1`, token);
      if (!row) return null;
      if (row.status !== "unsubscribed") {
        await run(`UPDATE subscribers SET status = 'unsubscribed', email = 'deleted:' || email_hash, tz = NULL, unsubscribed_at = ?2, updated_at = ?2 WHERE unsub_token = ?1`, token, now);
      }
      return row;
    },
    updatePrefs: async (token, p, now) => (await run(
      `UPDATE subscribers SET tz = ?2, hour = ?3, edition = ?4, hold_shabbat = ?5, updated_at = ?6 WHERE unsub_token = ?1 AND status = 'active'`,
      token, p.tz, p.hour, p.edition, p.hold_shabbat, now)) > 0,

    isSuppressed: async (h) => (await first<{ n: number }>(`SELECT 1 AS n FROM suppressions WHERE email_hash = ?1`, h)) !== null,
    findByEmailHash: (h) => first<SubscriberRow>(`SELECT * FROM subscribers WHERE email_hash = ?1 ORDER BY id LIMIT 1`, h),
    upsertConfirmed: async (s, now) => {
      const existing = await first<SubscriberRow>(`SELECT * FROM subscribers WHERE email_hash = ?1 ORDER BY id LIMIT 1`, s.email_hash);
      if (existing) {
        await run(
          `UPDATE subscribers SET email = ?2, tz = ?3, hour = ?4, edition = ?5, hold_shabbat = ?6, status = 'active', consent_version = ?7,
             confirmed_at = ?8, unsubscribed_at = NULL, updated_at = ?8 WHERE id = ?1`,
          existing.id, s.email, s.tz, s.hour, s.edition, s.hold_shabbat, s.consent_version, now);
        return (await first<SubscriberRow>(`SELECT * FROM subscribers WHERE id = ?1`, existing.id))!;
      }
      await run(
        `INSERT INTO subscribers (email, email_hash, tz, hour, edition, hold_shabbat, status, unsub_token, consent_version, created_at, confirmed_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9, ?9, ?9)`,
        s.email, s.email_hash, s.tz, s.hour, s.edition, s.hold_shabbat, s.unsub_token, s.consent_version, now);
      return (await first<SubscriberRow>(`SELECT * FROM subscribers WHERE unsub_token = ?1`, s.unsub_token))!;
    },

    recordEvent: async (ev) => (await run(
      `INSERT OR IGNORE INTO email_events (provider_event_id, type, email_hash, subscriber_id, received_at, payload) VALUES (?1,?2,?3,?4,?5,?6)`,
      ev.provider_event_id, ev.type, ev.email_hash, ev.subscriber_id, ev.received_at, ev.payload)) > 0,
    markBounced: (h, now) => run(`UPDATE subscribers SET status = 'bounced', updated_at = ?2 WHERE email_hash = ?1 AND status = 'active'`, h, now),
    markComplained: (h, now) => run(`UPDATE subscribers SET status = 'complained', updated_at = ?2 WHERE email_hash = ?1 AND status IN ('active', 'bounced')`, h, now),
    addSuppression: async (h, reason, now) => { await run(`INSERT OR IGNORE INTO suppressions (email_hash, reason, created_at) VALUES (?1, ?2, ?3)`, h, reason, now); },

    countByStatus: async () => {
      const rows = await all<{ status: string; n: number }>(`SELECT status, COUNT(*) AS n FROM subscribers GROUP BY status`);
      return Object.fromEntries(rows.map((r) => [r.status, r.n]));
    },
    activeCount: async () => (await first<{ n: number }>(`SELECT COUNT(*) AS n FROM subscribers WHERE status = 'active'`))?.n ?? 0,
    recentRuns: (limit) => all<SendRunRow>(`SELECT * FROM send_runs ORDER BY tick DESC LIMIT ?1`, limit),
    deliveryCounts: (dates) => all<{ edition_date: string; status: string; n: number }>(
      `SELECT edition_date, status, COUNT(*) AS n FROM deliveries WHERE edition_date IN (SELECT value FROM json_each(?1)) GROUP BY edition_date, status ORDER BY edition_date`, j(dates)),
    deleteEditions: (date) => run(`DELETE FROM editions WHERE edition_date = ?1`, date),
    housekeeping: async (now) => {
      const cut = (days: number) => new Date(new Date(now).getTime() - days * 86400000).toISOString().slice(0, 10);
      tick(3);
      await d1.batch([
        q(`DELETE FROM send_runs WHERE tick < ?1`, cut(90)),
        q(`DELETE FROM editions WHERE edition_date < ?1`, cut(60)),
        q(`DELETE FROM deliveries WHERE edition_date < ?1`, cut(60)),
      ]);
    },
    statementCount: () => count,
  };
}
