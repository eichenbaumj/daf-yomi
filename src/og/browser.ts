/**
 * Draws cards with Cloudflare Browser Rendering (the `browser` binding in wrangler.jsonc) through the
 * Cloudflare fork of puppeteer. One launch per invocation, one page: the template with its embedded fonts is
 * loaded once, then each card swaps the texts in place (`__dafSet`) and takes a screenshot, so the Worker's
 * share of the work per card is one small protocol round trip and a PNG decode.
 *
 * Free-plan limits (Cloudflare docs, 2026-09): 10 browser-minutes a day, 3 concurrent browsers, one new
 * instance every 20 seconds, 60 s idle timeout. Two different 429s come back from `launch`: the instance rate
 * (wait 21 s) and the daily budget (stop until tomorrow). Callers see them as `BrowserError` kinds.
 *
 * This is the only file that imports puppeteer. Everything else takes a `CardRenderer`, so tests use a fake.
 */
import puppeteer, { type Browser, type BrowserWorker, type Page } from "@cloudflare/puppeteer";
import { CARD_H, CARD_W, renderCardHtml, type CardModel, type FontFace } from "./card";
import { withTimeout } from "../util";

export interface CardRenderer {
  render(model: CardModel): Promise<Uint8Array>;
  close(): Promise<void>;
}

export type BrowserFailure = "budget" | "rate" | "other";

export class BrowserError extends Error {
  constructor(public readonly kind: BrowserFailure, message: string) {
    super(message);
    this.name = "BrowserError";
  }
}

/** Sort a launch failure by what to do about it: stop for the day, wait 21 s, or report. */
export function classifyBrowserError(e: unknown): BrowserFailure {
  const msg = e instanceof Error ? e.message : String(e);
  if (/time limit|for today|daily|budget|quota/i.test(msg)) return "budget";
  if (/429|rate ?limit|too many|every 20/i.test(msg)) return "rate";
  return "other";
}

export function browserRenderer(binding: Fetcher, fonts: readonly FontFace[], opts: { renderTimeoutMs?: number } = {}): CardRenderer {
  const timeoutMs = opts.renderTimeoutMs ?? 30_000;
  let browser: Browser | null = null;
  let page: Page | null = null;

  async function pageFor(model: CardModel): Promise<Page> {
    if (!page) {
      try {
        browser = await puppeteer.launch(binding as unknown as BrowserWorker);
      } catch (e) {
        throw new BrowserError(classifyBrowserError(e), e instanceof Error ? e.message : String(e));
      }
      const p = await browser.newPage();
      await p.setViewport({ width: CARD_W, height: CARD_H, deviceScaleFactor: 1 });
      await p.setContent(renderCardHtml(model, fonts), { waitUntil: "load" });
      page = p;
    } else {
      await page.evaluate(`window.__dafSet(${JSON.stringify(model)})`);
    }
    // Data-URI fonts load lazily on first use: measure only once they are in, or the fit uses fallback metrics.
    // (String form: the Worker is compiled without DOM types, and puppeteer evaluates the expression in the page.)
    await page.evaluate("document.fonts.ready.then(function () { return window.__dafFit(); })");
    return page;
  }

  return {
    async render(model) {
      const p = await withTimeout(pageFor(model), timeoutMs, `card ${model.label}`);
      const shot = await withTimeout(p.screenshot({ type: "png", clip: { x: 0, y: 0, width: CARD_W, height: CARD_H } }), timeoutMs, `screenshot ${model.label}`);
      // puppeteer hands back a Buffer (a Uint8Array view); keep the view, never its underlying buffer.
      return new Uint8Array(shot.buffer, shot.byteOffset, shot.byteLength);
    },
    async close() {
      const b = browser;
      browser = null;
      page = null;
      if (b) { try { await b.close(); } catch { /* already gone */ } }
    },
  };
}
