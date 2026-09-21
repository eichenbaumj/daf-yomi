/** In-memory NewsletterDb with the same semantics as the D1 implementation, for tests. */
import type { DeliveryRow, EditionRow, EventRow, NewSubscriber, NewsletterDb, Prefs, SendRunRow, SubscriberRow, Variant } from "../../src/newsletter/db";

export interface FakeDb extends NewsletterDb {
  subscribers: SubscriberRow[];
  deliveries: Map<string, DeliveryRow>;
  editions: Map<string, EditionRow>;
  runs: SendRunRow[];
  events: EventRow[];
  suppressions: Map<string, string>;
  addSubscriber(partial: Partial<SubscriberRow> & { email: string; tz: string }): SubscriberRow;
}

export function fakeDb(): FakeDb {
  let nextId = 1;
  let statements = 0;
  const subscribers: SubscriberRow[] = [];
  const deliveries = new Map<string, DeliveryRow>();
  const editions = new Map<string, EditionRow>();
  const runs: SendRunRow[] = [];
  const events: EventRow[] = [];
  const suppressions = new Map<string, string>();
  const k = (sid: number, date: string) => `${sid}:${date}`;
  const t = () => { statements++; };

  const db: FakeDb = {
    subscribers, deliveries, editions, runs, events, suppressions,
    addSubscriber(p) {
      const row: SubscriberRow = {
        id: nextId++, email: p.email, email_hash: p.email_hash ?? `h:${p.email}`, tz: p.tz, hour: p.hour ?? 6, edition: p.edition ?? "today",
        hold_shabbat: p.hold_shabbat ?? 0, status: p.status ?? "active", unsub_token: p.unsub_token ?? "a".repeat(48), consent_version: "test",
        created_at: "2026-09-01T00:00:00.000Z", confirmed_at: p.confirmed_at ?? "2026-09-01T00:00:00.000Z", unsubscribed_at: null, updated_at: "2026-09-01T00:00:00.000Z",
      };
      subscribers.push(row);
      return row;
    },
    async activeTimezones() { t(); return [...new Set(subscribers.filter((s) => s.status === "active" && s.tz).map((s) => s.tz!))]; },
    async activeSubscribersDue(pairs) { t(); return subscribers.filter((s) => s.status === "active" && pairs.some((p) => p.tz === s.tz && p.hour === s.hour)).sort((a, b) => a.id - b.id); },
    async deliveriesFor(dates, tzs) {
      t();
      return [...deliveries.values()].filter((d) => dates.includes(d.edition_date) && subscribers.some((s) => s.id === d.subscriber_id && s.status === "active" && tzs.includes(s.tz ?? "")));
    },
    async editionsFor(dates) { t(); return [...editions.values()].filter((e) => dates.includes(e.edition_date)); },
    async putEdition(e) { t(); editions.set(`${e.edition_date}|${e.variant}`, e); },
    async reserve(date, rows, now) {
      if (!rows.length) return; t();
      for (const r of rows) if (!deliveries.has(k(r.subscriber_id, date))) deliveries.set(k(r.subscriber_id, date), { subscriber_id: r.subscriber_id, edition_date: date, variant: r.variant, status: r.status, attempts: 0, batch_key: null, provider_id: null, last_error: null, updated_at: now });
    },
    async assignBatch(key, date, ids, now) { t(); for (const id of ids) { const d = deliveries.get(k(id, date)); if (d && d.status === "reserved") { d.batch_key = key; d.updated_at = now; } } },
    async markSent(date, sent, now) { if (!sent.length) return; t(); for (const s of sent) { const d = deliveries.get(k(s.subscriber_id, date)); if (d) { d.status = "sent"; d.attempts += 1; d.provider_id = s.provider_id; d.last_error = null; d.updated_at = now; } } },
    async markAttempt(key, error, failAt, now) { t(); for (const d of deliveries.values()) if (d.batch_key === key && d.status === "reserved") { d.attempts += 1; d.last_error = error; d.updated_at = now; if (d.attempts >= failAt) d.status = "failed"; } },
    async failStale(before, now) { t(); let n = 0; for (const d of deliveries.values()) if (d.status === "reserved" && d.edition_date < before) { d.status = "failed"; d.last_error = "stale"; d.updated_at = now; n++; } return n; },
    async recordRun(r) { t(); runs.push(r); },
    async findByToken(token) { t(); return subscribers.find((s) => s.unsub_token === token) ?? null; },
    async unsubscribe(token, now) {
      t(); const s = subscribers.find((x) => x.unsub_token === token); if (!s) return null;
      const before = { ...s };
      if (s.status !== "unsubscribed") { s.status = "unsubscribed"; s.email = `deleted:${s.email_hash}`; s.tz = null; s.unsubscribed_at = now; s.updated_at = now; }
      return before;
    },
    async updatePrefs(token, p: Prefs, now) { t(); const s = subscribers.find((x) => x.unsub_token === token && x.status === "active"); if (!s) return false; Object.assign(s, p, { updated_at: now }); return true; },
    async isSuppressed(h) { t(); return suppressions.has(h); },
    async findByEmailHash(h) { t(); return subscribers.find((s) => s.email_hash === h) ?? null; },
    async upsertConfirmed(n: NewSubscriber, now) {
      t(); const existing = subscribers.find((s) => s.email_hash === n.email_hash);
      if (existing) { Object.assign(existing, { email: n.email, tz: n.tz, hour: n.hour, edition: n.edition, hold_shabbat: n.hold_shabbat, status: "active", consent_version: n.consent_version, confirmed_at: now, unsubscribed_at: null, updated_at: now }); return existing; }
      return db.addSubscriber({ ...n, confirmed_at: now });
    },
    async recordEvent(ev) { t(); if (events.some((e) => e.provider_event_id === ev.provider_event_id)) return false; events.push(ev); return true; },
    async markBounced(h, now) { t(); let n = 0; for (const s of subscribers) if (s.email_hash === h && s.status === "active") { s.status = "bounced"; s.updated_at = now; n++; } return n; },
    async markComplained(h, now) { t(); let n = 0; for (const s of subscribers) if (s.email_hash === h && (s.status === "active" || s.status === "bounced")) { s.status = "complained"; s.updated_at = now; n++; } return n; },
    async addSuppression(h, reason) { t(); if (!suppressions.has(h)) suppressions.set(h, reason); },
    async countByStatus() { t(); const out: Record<string, number> = {}; for (const s of subscribers) out[s.status] = (out[s.status] ?? 0) + 1; return out; },
    async activeCount() { t(); return subscribers.filter((s) => s.status === "active").length; },
    async recentRuns(limit) { t(); return runs.slice(-limit).reverse(); },
    async deliveryCounts(dates) { t(); const m = new Map<string, number>(); for (const d of deliveries.values()) if (dates.includes(d.edition_date)) m.set(`${d.edition_date}|${d.status}`, (m.get(`${d.edition_date}|${d.status}`) ?? 0) + 1); return [...m].map(([key, n]) => { const [edition_date, status] = key.split("|") as [string, string]; return { edition_date, status, n }; }); },
    async deleteEditions(date) { t(); let n = 0; for (const key of [...editions.keys()]) if (key.startsWith(`${date}|`)) { editions.delete(key); n++; } return n; },
    async housekeeping() { statements += 3; },
    statementCount: () => statements,
  };
  void (null as unknown as Variant);
  return db;
}
