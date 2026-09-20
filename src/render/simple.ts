import type { Env } from "../types";
import { esc, page } from "./layout";

export function renderNotFound(env: Env, origin: string, path: string): string {
  const body = `<article class="prose"><header class="daf-head"><h1>Not a page we have</h1></header>
<p>Nothing lives at <code>${esc(path)}</code>. Pages look like <code>/bekhorot/2</code>: the tractate, then the daf.</p>
<p><a href="/">Today's daf</a> · <a href="/tractates">All tractates</a></p></article>`;
  return page({ env, origin, title: "Not found", description: "No such page.", canonicalPath: "/404", body });
}

export function renderError(env: Env, origin: string, message: string): string {
  const body = `<article class="prose"><header class="daf-head"><h1>The text did not load</h1></header>
<p>${esc(message)}</p>
<p>The text comes live from Sefaria and is not copied here, so when Sefaria is unreachable there is nothing to show. Try again in a minute, or read today's daf directly on <a href="https://www.sefaria.org/daf-yomi" rel="noopener">Sefaria</a>.</p></article>`;
  return page({ env, origin, title: "Temporarily unavailable", description: "The text could not be loaded from Sefaria.", canonicalPath: "/", body });
}
