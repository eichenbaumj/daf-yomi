import type { Env } from "../types";
import { TRACTATES } from "../daf/tractates";
import { dateForDaf, ymd, type DafRef } from "../daf/schedule";
import { p, type Lang } from "../i18n/strings";
import { shortDateL, strings, tractateName } from "../i18n/format";
import { esc, page } from "./layout";

export function renderTractatesIndex(env: Env, origin: string, today: DafRef, todayDate: Date, lang: Lang = "en"): string {
  const S = strings(lang);
  const cycle = today.cycle;
  const todayKey = ymd(todayDate);
  const bySeder = new Map<string, typeof TRACTATES>();
  for (const t of TRACTATES) {
    const key = t.seder || S.otherSeder;
    if (!bySeder.has(key)) bySeder.set(key, []);
    bySeder.get(key)!.push(t);
  }
  const groups = [...bySeder.entries()].map(([seder, list]) => {
    const rows = list.map((t) => {
      const start = dateForDaf(t, t.firstDaf, cycle);
      const end = dateForDaf(t, t.lastDaf, cycle);
      const state = ymd(end) < todayKey ? "past" : ymd(start) > todayKey ? "future" : "current";
      const heInline = lang === "en" ? ` <span lang="he" dir="rtl" class="he-inline">${esc(t.heTitle)}</span>` : "";
      return `<li class="${state}"><a href="${p(lang, `/${esc(t.slug)}`)}">${esc(tractateName(lang, t))}</a>${heInline} <span class="muted">${esc(S.daysAndRange(t.days, shortDateL(lang, start), shortDateL(lang, end)))}</span>${state === "current" ? ` <span class="now">${esc(S.now)}</span>` : ""}</li>`;
    });
    const he = list[0]?.sederHe ?? "";
    const heading = lang === "en"
      ? `${esc(seder)} ${he ? `<span lang="he" dir="rtl" class="he-inline">${esc(he)}</span>` : ""}`
      : esc(he || seder);
    return `<section><h2>${heading}</h2><ul class="tractate-list">${rows.join("")}</ul></section>`;
  });
  const body = `
<article>
  <header class="daf-head">
    <h1>${esc(S.tractatesHeading)}</h1>
    <p class="lede">${esc(S.tractatesLede(cycle))}</p>
  </header>
  ${groups.join("\n")}
</article>`;
  return page({ env, origin, lang, title: S.tractatesTitle, description: S.tractatesMetaDescription, canonicalPath: "/tractates", body });
}
