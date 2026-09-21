import { describe, expect, it } from "vitest";
import { batchKey, chunk, editionDateFor, heldDafimFor, localClock, planTick, MAX_ATTEMPTS } from "../src/newsletter/plan";
import { runSendTick, tickId } from "../src/newsletter/send";
import type { BatchOutcome, EmailProvider, OutboundEmail } from "../src/newsletter/provider";
import type { DeliveryRow } from "../src/newsletter/db";
import type { Env } from "../src/types";
import type { DafNote } from "../src/note/store";
import { fakeDb } from "./helpers/fakeDb";

const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y!, m! - 1, dd!); };
const never = () => false;
const notIsrael = () => false;
const note: DafNote = { summary: "S.", question: "Q?", quotes: [], model: "m", promptVersion: "v", generatedAt: "t", sources: [] };

describe("local clocks", () => {
  it("reads the hour in each zone, across half hours and DST", () => {
    expect(localClock("Pacific/Auckland", new Date("2026-09-20T18:00:00Z"))).toMatchObject({ ymd: "2026-09-21", hour: 6 });
    expect(localClock("Asia/Kolkata", new Date("2026-09-21T00:30:00Z"))).toMatchObject({ ymd: "2026-09-21", hour: 6 });
    expect(localClock("America/New_York", new Date("2027-03-14T07:00:00Z")).hour).toBe(3); // the 2 o'clock hour does not exist that night
    expect(localClock("America/New_York", new Date("2026-11-01T05:30:00Z")).hour).toBe(1); // the 1 o'clock hour happens twice
    expect(localClock("UTC", new Date("2026-09-21T00:00:00Z"))).toMatchObject({ ymd: "2026-09-21", hour: 0 });
    expect(localClock("Not/A_Zone", new Date("2026-09-21T13:00:00Z")).hour).toBe(13);
  });
});

describe("planTick", () => {
  const db = fakeDb();
  const ny = db.addSubscriber({ email: "ny@example.test", tz: "America/New_York", hour: 6 });
  const late = db.addSubscriber({ email: "late@example.test", tz: "America/New_York", hour: 23 });
  const eve = db.addSubscriber({ email: "eve@example.test", tz: "America/New_York", hour: 20, edition: "tomorrow" });
  const shab = db.addSubscriber({ email: "shab@example.test", tz: "America/New_York", hour: 6, hold_shabbat: 1 });
  const plan = (nowIso: string, o: Partial<Parameters<typeof planTick>[0]> = {}) => planTick({
    now: new Date(nowIso), catchupHours: 3, subscribers: db.subscribers, deliveries: [], notePresent: () => true, isRestDay: never, isIsraelTz: notIsrael, ...o,
  });

  it("is due exactly at the chosen hour and within the catch-up window", () => {
    const at6 = plan("2026-09-21T10:00:00Z"); // 06:00 EDT
    expect(at6.filter((a) => a.sub.id === ny.id).map((a) => [a.kind, a.editionDate, a.slot])).toEqual([["send", "2026-09-21", 0]]);
    expect(plan("2026-09-21T13:00:00Z").find((a) => a.sub.id === ny.id)?.slot).toBe(3);
    expect(plan("2026-09-21T14:00:00Z").find((a) => a.sub.id === ny.id)).toBeUndefined();
    expect(plan("2026-09-21T09:00:00Z").find((a) => a.sub.id === ny.id)).toBeUndefined();
  });
  it("wraps a late catch-up past midnight to the previous day's issue", () => {
    const a = plan("2026-09-22T05:00:00Z").find((x) => x.sub.id === late.id)!; // 01:00 EDT on the 22nd, chosen hour 23
    expect(a.slot).toBe(2);
    expect(a.editionDate).toBe("2026-09-21");
  });
  it("shifts the evening-before edition to tomorrow's daf", () => {
    const a = plan("2026-09-21T00:00:00Z").find((x) => x.sub.id === eve.id)!; // 20:00 EDT on the 20th
    expect(a.editionDate).toBe("2026-09-21");
    expect(editionDateFor(d("2026-09-20"), "tomorrow")).toBe("2026-09-21");
    expect(editionDateFor(d("2026-09-20"), "today")).toBe("2026-09-20");
  });
  it("defers while the note is missing, then generates once at the last slot", () => {
    expect(plan("2026-09-21T10:00:00Z", { notePresent: () => false }).find((a) => a.sub.id === ny.id)?.kind).toBe("defer");
    expect(plan("2026-09-21T12:00:00Z", { notePresent: () => false }).find((a) => a.sub.id === ny.id)?.kind).toBe("defer");
    expect(plan("2026-09-21T13:00:00Z", { notePresent: () => false }).find((a) => a.sub.id === ny.id)?.kind).toBe("ensure-then-send");
  });
  it("skips rows already sent, held or failed, and retries reserved ones", () => {
    const row = (status: DeliveryRow["status"], attempts = 0): DeliveryRow => ({ subscriber_id: ny.id, edition_date: "2026-09-21", variant: "full", status, attempts, batch_key: "k", provider_id: null, last_error: null, updated_at: "" });
    for (const s of ["sent", "held", "failed"] as const) expect(plan("2026-09-21T10:00:00Z", { deliveries: [row(s)] }).find((a) => a.sub.id === ny.id)).toBeUndefined();
    expect(plan("2026-09-21T11:00:00Z", { deliveries: [row("reserved", 1)] }).find((a) => a.sub.id === ny.id)).toMatchObject({ kind: "send", retry: true });
    expect(plan("2026-09-21T11:00:00Z", { deliveries: [row("reserved", MAX_ATTEMPTS)] }).find((a) => a.sub.id === ny.id)).toBeUndefined();
  });
  it("holds Shabbat and Yom Tov for readers who asked", () => {
    const sat = plan("2026-09-26T10:00:00Z", { isRestDay: (dt) => dt.getDay() === 6 });
    expect(sat.find((a) => a.sub.id === shab.id)?.kind).toBe("hold");
    expect(sat.find((a) => a.sub.id === ny.id)?.kind).toBe("send");
  });
  it("chunks and keys batches deterministically", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batchKey("2026-09-21", "full", 7, 50)).toBe("daf:2026-09-21:full:7:50");
  });
  it("lists the dapim a held reader missed", () => {
    const isRest = (dt: Date) => dt.getDay() === 6;
    const held = heldDafimFor(shab, d("2026-10-11"), false, isRest);
    expect(held.map((h) => [h.ref.tractate.slug, h.ref.daf])).toEqual([["bekhorot", 22]]);
    const heldEve = heldDafimFor({ ...shab, edition: "tomorrow" }, d("2026-10-11"), false, isRest);
    expect(heldEve.map((h) => h.ref.daf)).toEqual([23]);
    expect(heldDafimFor(shab, d("2026-10-13"), false, isRest)).toEqual([]);
  });
});

function fakeProvider(script: BatchOutcome[]): EmailProvider & { calls: { emails: OutboundEmail[]; key: string }[] } {
  const calls: { emails: OutboundEmail[]; key: string }[] = [];
  return {
    name: "fake", maxBatch: 100, calls,
    async sendBatch(emails, key) { calls.push({ emails, key }); return script.shift() ?? { ok: true, ids: emails.map((_, i) => `id-${calls.length}-${i}`) }; },
    async sendOne() { return { ok: true, id: "one" }; },
  };
}
const env = { SITE_NAME: "Today's Daf", CANONICAL_HOST: "example.test", CATCHUP_HOURS: "3", EMAIL_HEBREW: "1", NEWSLETTER_FROM: "Today's Daf <daf@news.example.test>", NEWSLETTER_REPLY_TO: "daf@example.test" } as unknown as Env;
const quiet = async () => {};

describe("runSendTick", () => {
  it("sends one batch to the readers who are due, with the right key and headers", async () => {
    const db = fakeDb();
    const a = db.addSubscriber({ email: "a@example.test", tz: "America/New_York", hour: 6, unsub_token: "b".repeat(48) });
    db.addSubscriber({ email: "il@example.test", tz: "Asia/Jerusalem", hour: 6 });
    const provider = fakeProvider([]);
    const run = await runSendTick(env, Date.parse("2026-09-21T10:00:00Z"), { db, provider, getNote: async () => note, ensure: quiet, alert: quiet });
    expect(run).toMatchObject({ tick: "2026-09-21T10", due: 1, sent: 1, deferred: 0, held: 0, failed: 0 });
    expect(provider.calls.length).toBe(1);
    const call = provider.calls[0]!;
    expect(call.key).toBe(`daf:2026-09-21:full:${a.id}:1`);
    expect(call.emails[0]!.to).toBe("a@example.test");
    expect(call.emails[0]!.subject).toBe("Bekhorot 3 · Monday, 21 September");
    expect(call.emails[0]!.headers?.["List-Unsubscribe"]).toBe(`<https://example.test/newsletter/u/${"b".repeat(48)}>`);
    expect(call.emails[0]!.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(call.emails[0]!.html).toContain(`https://example.test/newsletter/u/${"b".repeat(48)}`);
    expect(call.emails[0]!.html).not.toContain("__UNSUB__");
    expect(call.emails[0]!.from).toBe("Today's Daf <daf@news.example.test>");
    expect(call.emails[0]!.replyTo).toBe("daf@example.test");
    const row = db.deliveries.get(`${a.id}:2026-09-21`)!;
    expect(row).toMatchObject({ status: "sent", attempts: 1, provider_id: "id-1-0", variant: "full" });
    expect(db.editions.get("2026-09-21|full")).toBeTruthy();
    expect(db.runs.length).toBe(1);
    expect(db.statementCount()).toBeLessThan(15);
    // The next tick has nothing to do for this reader.
    const again = await runSendTick(env, Date.parse("2026-09-21T11:00:00Z"), { db, provider, getNote: async () => note, ensure: quiet, alert: quiet });
    expect(again.sent).toBe(0);
    expect(provider.calls.length).toBe(1);
  });

  it("leaves rows reserved on a 429 and replays the same key next hour", async () => {
    const db = fakeDb();
    const a = db.addSubscriber({ email: "a@example.test", tz: "America/New_York", hour: 6 });
    const provider = fakeProvider([{ ok: false, status: 429, body: "slow down", retryable: true, treatAsSent: false }]);
    const alerts: string[] = [];
    const first = await runSendTick(env, Date.parse("2026-09-21T10:00:00Z"), { db, provider, getNote: async () => note, ensure: quiet, alert: async (_e, kind) => { alerts.push(kind); } });
    expect(first.sent).toBe(0);
    expect(first.failed).toBe(0);
    const row = db.deliveries.get(`${a.id}:2026-09-21`)!;
    expect(row).toMatchObject({ status: "reserved", attempts: 1 });
    expect(row.batch_key).toBe(`daf:2026-09-21:full:${a.id}:1`);
    expect(alerts).toContain("send-retry");
    const second = await runSendTick(env, Date.parse("2026-09-21T11:00:00Z"), { db, provider, getNote: async () => note, ensure: quiet, alert: quiet });
    expect(second.sent).toBe(1);
    expect(provider.calls.map((c) => c.key)).toEqual([row.batch_key, row.batch_key]);
    expect(db.deliveries.get(`${a.id}:2026-09-21`)).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("treats a 409 as already sent", async () => {
    const db = fakeDb();
    db.addSubscriber({ email: "a@example.test", tz: "America/New_York", hour: 6 });
    const provider = fakeProvider([{ ok: false, status: 409, body: "invalid_idempotent_request", retryable: false, treatAsSent: true }]);
    const run = await runSendTick(env, Date.parse("2026-09-21T10:00:00Z"), { db, provider, getNote: async () => note, ensure: quiet, alert: quiet });
    expect(run.sent).toBe(1);
    expect([...db.deliveries.values()][0]).toMatchObject({ status: "sent", provider_id: "replayed" });
  });

  it("fails a batch outright on a non-retryable error", async () => {
    const db = fakeDb();
    db.addSubscriber({ email: "a@example.test", tz: "America/New_York", hour: 6 });
    const provider = fakeProvider([{ ok: false, status: 422, body: "validation", retryable: false, treatAsSent: false }]);
    const run = await runSendTick(env, Date.parse("2026-09-21T10:00:00Z"), { db, provider, getNote: async () => note, ensure: quiet, alert: quiet });
    expect(run.failed).toBe(1);
    expect([...db.deliveries.values()][0]).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("defers while the note is missing, then sends the honest card after one generation attempt", async () => {
    const db = fakeDb();
    db.addSubscriber({ email: "a@example.test", tz: "America/New_York", hour: 6 });
    const provider = fakeProvider([]);
    let ensures = 0;
    const deps = { db, provider, getNote: async () => null, ensure: async () => { ensures++; }, alert: quiet };
    for (const h of ["10", "11", "12"]) {
      const run = await runSendTick(env, Date.parse(`2026-09-21T${h}:00:00Z`), deps);
      expect(run.deferred).toBe(1);
      expect(run.sent).toBe(0);
    }
    expect(db.deliveries.size).toBe(0);
    const last = await runSendTick(env, Date.parse("2026-09-21T13:00:00Z"), deps);
    expect(ensures).toBe(1);
    expect(last.sent).toBe(1);
    expect([...db.deliveries.values()][0]!.variant).toBe("nonote");
    expect(provider.calls[0]!.emails[0]!.html).toContain("was not written in time");
    expect(provider.calls[0]!.key).toContain(":nonote:");
  });

  it("holds Shabbat issues for readers who asked and records the hold", async () => {
    const db = fakeDb();
    db.addSubscriber({ email: "hold@example.test", tz: "America/New_York", hour: 6, hold_shabbat: 1 });
    db.addSubscriber({ email: "send@example.test", tz: "America/New_York", hour: 6 });
    const provider = fakeProvider([]);
    // Saturday 10 October 2026 is a plain Shabbat (26 and 27 September would both be Yom Tov in the diaspora).
    const run = await runSendTick(env, Date.parse("2026-10-10T10:00:00Z"), { db, provider, getNote: async () => note, ensure: quiet, alert: quiet });
    expect(run).toMatchObject({ due: 2, sent: 1, held: 1 });
    expect([...db.deliveries.values()].map((r) => r.status).sort()).toEqual(["held", "sent"]);
    // Sunday's issue names the held daf for that reader only.
    const sunday = await runSendTick(env, Date.parse("2026-10-11T10:00:00Z"), { db, provider, getNote: async () => note, ensure: quiet, alert: quiet });
    expect(sunday.sent).toBe(2);
    const mails = provider.calls.flatMap((c) => c.emails);
    const toHolder = mails.find((m) => m.to === "hold@example.test" && m.subject.startsWith("Bekhorot 23"))!;
    expect(toHolder.html).toContain("Held for Shabbat and Yom Tov");
    expect(toHolder.html).toContain("Bekhorot 22");
    const toOther = mails.find((m) => m.to === "send@example.test" && m.subject.startsWith("Bekhorot 23"))!;
    expect(toOther.html).not.toContain("Held for Shabbat");
  });

  it("does nothing without a provider or subscribers", async () => {
    const db = fakeDb();
    const noKey = await runSendTick(env, Date.parse("2026-09-21T10:00:00Z"), { db, getNote: async () => note, ensure: quiet, alert: quiet });
    expect(noKey.log).toContain("no email provider");
    const empty = await runSendTick(env, Date.parse("2026-09-21T10:00:00Z"), { db, provider: fakeProvider([]), getNote: async () => note, ensure: quiet, alert: quiet });
    expect(empty.log).toContain("no active subscribers");
    expect(tickId(new Date("2026-09-21T10:00:00Z"))).toBe("2026-09-21T10");
  });
});
