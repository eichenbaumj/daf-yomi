import type { Env } from "../types";
import { TRACTATES } from "../daf/tractates";
import { dateForDaf, shortDate, ymd, type DafRef } from "../daf/schedule";
import { esc, page } from "./layout";

export function renderTractatesIndex(env: Env, origin: string, today: DafRef, todayDate: Date): string {
  const cycle = today.cycle;
  const todayKey = ymd(todayDate);
  const bySeder = new Map<string, typeof TRACTATES>();
  for (const t of TRACTATES) {
    const key = t.seder || "Other";
    if (!bySeder.has(key)) bySeder.set(key, []);
    bySeder.get(key)!.push(t);
  }
  const groups = [...bySeder.entries()].map(([seder, list]) => {
    const rows = list.map((t) => {
      const start = dateForDaf(t, t.firstDaf, cycle);
      const end = dateForDaf(t, t.lastDaf, cycle);
      const state = ymd(end) < todayKey ? "past" : ymd(start) > todayKey ? "future" : "current";
      return `<li class="${state}"><a href="/${esc(t.slug)}">${esc(t.name)}</a> <span lang="he" dir="rtl" class="he-inline">${esc(t.heTitle)}</span> <span class="muted">${t.days} days · ${esc(shortDate(start))} to ${esc(shortDate(end))}</span>${state === "current" ? ' <span class="now">now</span>' : ""}</li>`;
    });
    const he = list[0]?.sederHe ?? "";
    return `<section><h2>${esc(seder)} ${he ? `<span lang="he" dir="rtl" class="he-inline">${esc(he)}</span>` : ""}</h2><ul class="tractate-list">${rows.join("")}</ul></section>`;
  });
  const body = `
<article>
  <header class="daf-head">
    <h1>The tractates</h1>
    <p class="lede">The Daf Yomi cycle reads the Babylonian Talmud in print order, one two-sided page a day, 2,711 days from Berakhot 2 to Niddah 73. Dates below are for cycle ${cycle}.</p>
  </header>
  ${groups.join("\n")}
</article>`;
  return page({ env, origin, title: "Tractates", description: "Every tractate in the Daf Yomi cycle, with dates for the current cycle.", canonicalPath: "/tractates", body });
}
