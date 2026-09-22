import { describe, expect, it } from "vitest";
import { CARD_H, CARD_SCRIPT, CARD_VERSION, CARD_W, ORDERS, Q_MAX_PX, Q_MIN_PX, cardToken, renderCardHtml, tickLeft, type FontFace } from "../src/og/card";
import { OG_CURSOR_KEY, cardCurrent, cardNeedsRender, cardPath, getCard, getCardMeta, ogKey, putCard, type CardMeta } from "../src/og/store";
import { CARD_CRON, NEAR_OFFSETS, bakeCards, cardModelFor, runCardBake, targetFor, trickleTargets } from "../src/og/bake";
import { BrowserError, classifyBrowserError, type CardRenderer } from "../src/og/browser";
import { parseRoute } from "../src/router";
import { dafForDate, dateForDaf, ymd } from "../src/daf/schedule";
import { tractateBySlug } from "../src/daf/tractates";
import { noteKey, type DafNote } from "../src/note/store";
import type { Env } from "../src/types";

const env = { SITE_NAME: "Today's Daf", SITE_TAGLINE: "tag", DEFAULT_TIMEZONE: "UTC", NOTE_MODEL: "claude-opus-5", CANONICAL_HOST: "daf-yomi.dev" } as unknown as Env;
const d = (s: string) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y!, m! - 1, dd!); };
const ref = dafForDate(d("2026-09-20")); // Bekhorot 2, day 2,451 of cycle 14
const date = dateForDaf(ref.tractate, ref.daf, ref.cycle);
const note = (over: Partial<DafNote> = {}): DafNote => ({ summary: "The Mishna opens with five ways a gentile can hold a stake in a donkey, and in all five the young animal is exempt.", question: "Why does the Mishna count five cases when one rule would do?", quotes: [], model: "m", promptVersion: "v", generatedAt: "2026-09-19T06:00:00.000Z", sources: [], ...over });
const fonts: FontFace[] = [{ family: "Source Serif 4", style: "italic", weight: "400", unicodeRange: "U+0000-00FF", base64: "AAAA" }];

/** Enough of KVNamespace for the store and the bake: values plus metadata, `stream` and `arrayBuffer` reads. */
class FakeKV {
  store = new Map<string, { value: Uint8Array | string; metadata?: unknown }>();
  writes = 0;
  async get(key: string, type?: string) {
    const v = this.store.get(key);
    if (!v) return null;
    const text = typeof v.value === "string" ? v.value : new TextDecoder().decode(v.value);
    return type === "json" ? JSON.parse(text) : text;
  }
  async getWithMetadata(key: string, type?: string) {
    const v = this.store.get(key);
    if (!v) return { value: null, metadata: null };
    const bytes = typeof v.value === "string" ? new TextEncoder().encode(v.value) : v.value;
    if (type === "arrayBuffer") return { value: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), metadata: v.metadata ?? null };
    let cancelled = false;
    return { value: { cancel: async () => { cancelled = true; }, get cancelled() { return cancelled; } }, metadata: v.metadata ?? null };
  }
  async put(key: string, value: string | Uint8Array | ArrayBuffer, opts?: { metadata?: unknown }) {
    this.writes++;
    this.store.set(key, { value: value instanceof ArrayBuffer ? new Uint8Array(value) : value, metadata: opts?.metadata });
  }
}
const envWith = (kv: FakeKV, over: Partial<Env> = {}) => ({ ...env, DAF_KV: kv as unknown as KVNamespace, ...over }) as Env;
const fakeRenderer = (log: string[] = [], fail?: (label: string) => Error | null): CardRenderer & { closed: number } => ({
  closed: 0,
  async render(m) { const e = fail?.(m.label); if (e) throw e; log.push(m.label); return new Uint8Array([0x89, 0x50, 0x4e, 0x47, m.summary.length % 256]); },
  async close() { this.closed++; },
});

describe("card template", () => {
  const model = cardModelFor(env, ref, date, note());
  it("carries the daf, the date, the note, the wordmark and the AI label, in the page's palette", () => {
    const html = renderCardHtml(model, fonts);
    expect(html).toContain('<span id="label">Bekhorot 2</span>');
    expect(html).toContain('id="he" lang="he" dir="rtl">בכורות</span>');
    expect(html).toContain("Sunday, 20 September 2026 · 9 Tishrei 5787");
    expect(html).toContain('<span id="qt">The Mishna opens with five ways a gentile can hold a stake in a donkey, and in all five the young animal is exempt.</span>');
    expect(html).not.toContain("Why does the Mishna count"); // the question waits on the page
    expect(html).toContain("TODAY&#39;S DAF");
    expect(html).toContain('<div class="chip">AI NOTE</div>');
    expect(html).toContain("Written by Claude, an AI. Not a scholar.");
    expect(html).toContain('<span class="site">daf-yomi.dev</span>');
    expect(html).toContain("--paper:#f3ead7");
    expect(html).toContain("--accent:#8b2e1f");
    expect(html).toContain(`width:${CARD_W}px;height:${CARD_H}px`);
    expect(html).toContain('@font-face{font-family:"Source Serif 4";font-style:italic;font-weight:400;font-display:block;src:url(data:font/woff2;base64,AAAA)');
    expect(html).toContain("window.__dafFit = function");
    expect(html).toContain("window.__dafSet = function");
    expect(html).not.toMatch(/—/);
    expect(html).not.toContain("✦"); // the fonts have no U+2726: the star is SVG
    expect((html.match(/<svg class="star"/g) ?? []).length).toBe(2);
    expect(html).toContain('<html lang="en" dir="ltr">');
  });
  it("escapes the note and the label", () => {
    const html = renderCardHtml({ ...model, summary: '<script>x</script> "quoted"' }, fonts);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt; &quot;quoted&quot;");
  });
  it("draws the six Orders sized by days, with the tick at this daf", () => {
    expect(ORDERS.map((o) => o.days)).toEqual([63, 731, 605, 682, 558, 72]);
    expect(ORDERS.reduce((a, o) => a + o.days, 0)).toBe(2711);
    const html = renderCardHtml(model, fonts);
    expect(html).toContain(`<div id="tick" style="left:${tickLeft(2451, 2711)}px"></div>`);
    expect(tickLeft(1, 2711)).toBeCloseTo(90.2, 0);
    expect(tickLeft(2711, 2711)).toBeCloseTo(1109.8, 0);
    expect(html).toContain('style="flex:731 731 0;background:#a4702f"');
  });
  it("fits the note by stepping the type down, never by cutting it", () => {
    expect(CARD_SCRIPT).toContain(`var s = ${Q_MAX_PX};`);
    expect(CARD_SCRIPT).toContain(`while (s > ${Q_MIN_PX} && q.scrollHeight > box.clientHeight)`);
    expect(CARD_SCRIPT).not.toMatch(/slice|substring|ellipsis|…/);
    expect(Q_MAX_PX).toBeGreaterThan(Q_MIN_PX);
  });
  it("makes a Hebrew card right to left with the Hebrew label (the seam for later)", () => {
    const he = renderCardHtml(cardModelFor(env, ref, date, note({ summary: "המשנה מונה חמישה מקרים." }), "he"), fonts);
    expect(he).toContain('<html lang="he" dir="rtl">');
    expect(he).toContain('<span id="label">בכורות ב׳</span>');
    expect(he).toContain("הדף היומי");
    expect(he).toContain("הערת AI");
    expect(he).toContain("קלוד");
  });
  it("versions the URL by design, cycle, note and render time", () => {
    const a = cardToken({ generatedAt: "g1", renderedAt: "r1", cycle: 14 });
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(cardToken({ generatedAt: "g1", renderedAt: "r1", cycle: 14 })).toBe(a);
    expect(cardToken({ generatedAt: "g2", renderedAt: "r1", cycle: 14 })).not.toBe(a);
    expect(cardToken({ generatedAt: "g1", renderedAt: "r2", cycle: 14 })).not.toBe(a);
    expect(cardToken({ generatedAt: "g1", renderedAt: "r1", cycle: 15 })).not.toBe(a);
    expect(cardToken({ generatedAt: "g1", renderedAt: "r1", cycle: 14 }, CARD_VERSION + 1)).not.toBe(a);
  });
});

describe("card store", () => {
  const meta: CardMeta = { of: "2026-09-19T06:00:00.000Z", cv: CARD_VERSION, cycle: 14, token: "deadbeef", bytes: 5, renderedAt: "2026-09-19T06:20:00.000Z" };
  it("keys and paths", () => {
    expect(ogKey(ref.tractate, 2)).toBe("og:v1:bekhorot:2");
    expect(cardPath(ref.tractate, 2, "deadbeef")).toBe("/og/bekhorot/2/deadbeef.png");
  });
  it("is current only while it shows the note's question; needs a redraw for a new question, design or cycle", () => {
    expect(cardCurrent(note(), meta)).toBe(true);
    expect(cardCurrent(note({ generatedAt: "later" }), meta)).toBe(false);
    expect(cardCurrent(null, meta)).toBe(false);
    expect(cardCurrent(note(), null)).toBe(false);
    expect(cardNeedsRender(note(), null, 14)).toBe(true);
    expect(cardNeedsRender(note(), meta, 14)).toBe(false);
    expect(cardNeedsRender(note({ generatedAt: "later" }), meta, 14)).toBe(true);
    expect(cardNeedsRender(note(), { ...meta, cv: CARD_VERSION - 1 }, 14)).toBe(true);
    expect(cardNeedsRender(note(), meta, 15)).toBe(true);
    // design-stale still counts as current for the page: the question is right, only the picture is old
    expect(cardCurrent(note(), { ...meta, cv: CARD_VERSION - 1 })).toBe(true);
  });
  it("reads metadata without the bytes, and the bytes with the metadata", async () => {
    const kv = new FakeKV();
    await putCard(kv as unknown as KVNamespace, ref.tractate, 2, new Uint8Array([1, 2, 3, 4, 5]), meta);
    expect(kv.store.get("og:v1:bekhorot:2")?.metadata).toEqual(meta);
    expect(await getCardMeta(kv as unknown as KVNamespace, ref.tractate, 2)).toEqual(meta);
    expect(await getCardMeta(kv as unknown as KVNamespace, ref.tractate, 3)).toBeNull();
    const card = await getCard(kv as unknown as KVNamespace, ref.tractate, 2);
    expect(card?.meta.token).toBe("deadbeef");
    expect(new Uint8Array(card!.png)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });
});

describe("card routes", () => {
  it("parses the image URL and the admin endpoints, English only", () => {
    expect(parseRoute("/og/bekhorot/2/deadbeef.png")).toEqual({ kind: "og-card", tractate: tractateBySlug("bekhorot"), daf: 2, token: "deadbeef" });
    expect(parseRoute("/og/bekhorot/99/deadbeef.png")).toEqual({ kind: "not-found" }); // Bekhorot ends at 61
    expect(parseRoute("/og/nothing/2/deadbeef.png")).toEqual({ kind: "not-found" });
    expect(parseRoute("/og/bekhorot/2/DEADBEEF.png")).toEqual({ kind: "redirect", to: "/og/bekhorot/2/deadbeef.png" });
    expect(parseRoute("/og/bekhorot/2/deadbee.png")).toEqual({ kind: "not-found" });
    expect(parseRoute("/he/og/bekhorot/2/deadbeef.png")).toEqual({ kind: "not-found", lang: "he" });
    expect(parseRoute("/admin/og/bake")).toEqual({ kind: "admin-og", action: "bake" });
    expect(parseRoute("/admin/og/status")).toEqual({ kind: "admin-og", action: "status" });
    expect(parseRoute("/he/admin/og/bake")).toEqual({ kind: "not-found", lang: "he" });
  });
});

describe("card bake", () => {
  it("draws a missing card, stores it with provenance, and leaves a current one alone", async () => {
    const kv = new FakeKV();
    await kv.put(noteKey(ref.tractate, 2), JSON.stringify(note()));
    const drawn: string[] = [];
    const r = fakeRenderer(drawn);
    const now = new Date("2026-09-19T06:20:00.000Z");
    const first = await bakeCards(envWith(kv), [targetFor(ref), targetFor(ref)], r, { now }); // duplicate dropped
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ daf: "bekhorot/2", status: "rendered", bytes: 5 });
    expect(drawn).toEqual(["Bekhorot 2"]);
    const meta = await getCardMeta(kv as unknown as KVNamespace, ref.tractate, 2);
    expect(meta).toMatchObject({ of: note().generatedAt, cv: CARD_VERSION, cycle: 14, bytes: 5, renderedAt: now.toISOString() });
    expect(meta!.token).toBe(cardToken({ generatedAt: note().generatedAt, renderedAt: now.toISOString(), cycle: 14 }));
    const again = await bakeCards(envWith(kv), [targetFor(ref)], r, { now });
    expect(again[0]).toMatchObject({ status: "current", token: meta!.token });
    expect(drawn).toHaveLength(1);
    const forced = await bakeCards(envWith(kv), [targetFor(ref)], r, { force: true, now: new Date("2026-09-19T07:00:00.000Z") });
    expect(forced[0]!.status).toBe("rendered");
    expect((forced[0] as { token: string }).token).not.toBe(meta!.token); // a redraw is a new URL
  });
  it("redraws when the note changed, reports a daf without a note, and stops the batch on a browser budget failure", async () => {
    const kv = new FakeKV();
    await kv.put(noteKey(ref.tractate, 2), JSON.stringify(note()));
    await putCard(kv as unknown as KVNamespace, ref.tractate, 2, new Uint8Array([1]), { of: "older", cv: CARD_VERSION, cycle: 14, token: "00000000", bytes: 1, renderedAt: "x" });
    const three = dafForDate(d("2026-09-21"));
    const four = dafForDate(d("2026-09-22"));
    await kv.put(noteKey(four.tractate, four.daf), JSON.stringify(note()));
    const out = await bakeCards(envWith(kv), [targetFor(ref), targetFor(three), targetFor(four)], fakeRenderer([], (label) => (label === "Bekhorot 4" ? new BrowserError("budget", "Browser time limit exceeded for today") : null)));
    expect(out.map((o) => o.status)).toEqual(["rendered", "no-note", "failed"]);
    expect(out[2]).toMatchObject({ kind: "budget" });
    const other = await bakeCards(envWith(kv), [targetFor(four), targetFor(ref)], fakeRenderer([], (label) => (label === "Bekhorot 4" ? new Error("boom") : null)), { force: true });
    expect(other.map((o) => o.status)).toEqual(["failed", "rendered"]); // an ordinary failure does not stop the batch
  });
  it("sorts browser failures into budget, rate and other", () => {
    expect(classifyBrowserError(new Error("Unable to create new browser: code: 429: message: Browser time limit exceeded for today"))).toBe("budget");
    expect(classifyBrowserError(new Error("code: 429: message: Rate limit exceeded: 1 new browser every 20 seconds"))).toBe("rate");
    expect(classifyBrowserError(new Error("socket hang up"))).toBe("other");
  });
  it("runs the near days first, then the trickle from the cursor, and moves the cursor before drawing", async () => {
    const kv = new FakeKV();
    const now = new Date("2026-09-20T06:20:00.000Z");
    // notes for tomorrow (Bekhorot 3), today (2) and day 1 of the cycle (Berakhot 2); none for 4 or yesterday
    for (const s of ["2026-09-21", "2026-09-20"]) { const r = dafForDate(d(s)); await kv.put(noteKey(r.tractate, r.daf), JSON.stringify(note())); }
    const berakhot = tractateBySlug("berakhot")!;
    await kv.put(noteKey(berakhot, 2), JSON.stringify(note()));
    const drawn: string[] = [];
    let made = 0;
    const res = await runCardBake(envWith(kv, { OG_TRICKLE_PER_RUN: "1" }), now.getTime(), { now, makeRenderer: () => { made++; return fakeRenderer(drawn); } });
    expect(NEAR_OFFSETS).toEqual([1, 0, 2, -1]);
    expect(made).toBe(1);
    expect(drawn).toEqual(["Bekhorot 3", "Bekhorot 2", "Berakhot 2"]);
    const noNote = res.outcomes.filter((o) => o.status === "no-note").map((o) => o.daf);
    expect(noNote).toContain("bekhorot/4"); // the day after tomorrow
    expect(res.outcomes.filter((o) => o.status === "no-note").length).toBe(2); // day after tomorrow and yesterday
    expect(await kv.get(OG_CURSOR_KEY)).toBe("2"); // scanned day 1 only: the trickle wanted one card and found it at once
    expect(res.log.some((l) => l.includes("cursor now day 2"))).toBe(true);
    // second run: everything current, no browser made
    const again = await runCardBake(envWith(kv, { OG_TRICKLE_PER_RUN: "1" }), now.getTime(), { now, makeRenderer: () => { made++; return fakeRenderer(drawn); } });
    expect(made).toBe(1);
    expect(again.log.some((l) => l.startsWith("nothing to draw"))).toBe(true);
    expect(await kv.get(OG_CURSOR_KEY)).toBe("32"); // scanned days 2..31 (the scan limit, max(4 x want, 30)) and found no note
  });
  it("skips drawing when there is no browser binding, and survives a renderer error", async () => {
    const kv = new FakeKV();
    const now = new Date("2026-09-20T06:20:00.000Z");
    const r = dafForDate(d("2026-09-21"));
    await kv.put(noteKey(r.tractate, r.daf), JSON.stringify(note()));
    const none = await runCardBake(envWith(kv, { OG_TRICKLE_PER_RUN: "0" }), now.getTime(), { now });
    expect(none.log.some((l) => l.includes("no browser binding"))).toBe(true);
    expect(await getCardMeta(kv as unknown as KVNamespace, r.tractate, r.daf)).toBeNull();
    const broken = fakeRenderer([], () => new Error("boom"));
    const res = await runCardBake(envWith(kv, { OG_TRICKLE_PER_RUN: "0" }), now.getTime(), { now, makeRenderer: () => broken });
    expect(res.outcomes.find((o) => o.daf === "bekhorot/3")).toMatchObject({ status: "failed", reason: "boom" });
    expect(broken.closed).toBe(1); // the browser is closed even when a card fails
  });
  it("wraps the trickle cursor at the end of the cycle", async () => {
    const kv = new FakeKV();
    await kv.put(OG_CURSOR_KEY, "2711");
    const niddah = tractateBySlug("niddah")!;
    await kv.put(noteKey(niddah, 73), JSON.stringify(note()));
    const log: string[] = [];
    const found = await trickleTargets(envWith(kv), 14, 1, (s) => log.push(s));
    expect(found.map((t) => `${t.ref.tractate.slug}/${t.ref.daf}`)).toEqual(["niddah/73"]);
    expect(ymd(found[0]!.date)).toBe("2027-06-07");
    expect(await kv.get(OG_CURSOR_KEY)).toBe("1");
  });
  it("names its cron", () => {
    expect(CARD_CRON).toBe("20 6,18 * * *");
  });
});
