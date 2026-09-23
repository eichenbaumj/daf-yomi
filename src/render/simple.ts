import type { Env } from "../types";
import { p, type Lang } from "../i18n/strings";
import { strings } from "../i18n/format";
import { esc, page } from "./layout";

export function renderNotFound(env: Env, origin: string, path: string, lang: Lang = "en"): string {
  const S = strings(lang);
  const body = `<article class="prose"><header class="daf-head"><h1>${esc(S.notFoundHeading)}</h1></header>
<p>${S.notFoundBody(esc(path))}</p>
<p><a href="${p(lang, "/")}">${esc(S.todaysDaf)}</a> · <a href="${p(lang, "/tractates")}">${esc(S.allTractates)}</a></p></article>`;
  return page({ env, origin, lang, title: S.notFoundTitle, description: S.notFoundDescription, robots: "noindex", body, noLangSwitch: true });
}

export function renderError(env: Env, origin: string, message: string, lang: Lang = "en"): string {
  const S = strings(lang);
  const body = `<article class="prose"><header class="daf-head"><h1>${esc(S.errorHeading)}</h1></header>
<p>${esc(message)}</p>
<p>${S.errorBody}</p></article>`;
  return page({ env, origin, lang, title: S.errorTitle, description: S.errorDescription, canonicalPath: "/", body, noLangSwitch: true });
}
