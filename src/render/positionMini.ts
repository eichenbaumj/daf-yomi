/**
 * The header's miniature map: where today sits in the whole Babylonian Talmud.
 * Row 1: the six Orders as a thin bar, the current one at full strength, a
 * hairline at today's day. Row 2: this tractate's dapim as tiny cells, learned
 * ones filled, today in the accent colour, chapter starts marked by a gap.
 * Same ordinal ramp tokens (--s1..--s6) as the About-page diagram.
 */
import { CYCLE_LENGTH, TRACTATES, type Tractate } from "../daf/tractates";
import type { DafRef } from "../daf/schedule";
import { SEDARIM } from "./dafYomiDiagram";
import { esc } from "./layout";

function sederIndex(name: string): number {
  return SEDARIM.findIndex((s) => s.name === name);
}

function amudToDaf(ref: string): number {
  return Number(/^(\d+)/.exec(ref)?.[1] ?? NaN);
}

export function renderPositionMini(ref: DafRef, learnedThroughDaf: number): string {
  const t: Tractate = ref.tractate;
  const pct = (d: number) => `${((d / CYCLE_LENGTH) * 100).toFixed(3)}%`;
  const bySeder = new Map<string, number>();
  for (const x of TRACTATES) bySeder.set(x.seder, (bySeder.get(x.seder) ?? 0) + x.days);
  const orders = SEDARIM.map((s, i) => {
    const days = bySeder.get(s.name) ?? 0;
    const cur = s.name === t.seder ? " cur" : "";
    return `<span class="seg s${i + 1}${cur}" style="width:${pct(days)}" title="${esc(s.name)}: ${days} days"></span>`;
  }).join("");
  const mark = `<span class="mark" style="left:${pct(ref.dayInCycle - 0.5)}" title="Day ${ref.dayInCycle} of ${CYCLE_LENGTH}"></span>`;

  const chapterStarts = new Set(t.chapters.map((c) => amudToDaf(c.startDaf)).filter((n) => n > t.firstDaf));
  const cells: string[] = [];
  for (let d = t.firstDaf; d <= t.lastDaf; d++) {
    const cls = ["dc", d === ref.daf ? "today" : d < learnedThroughDaf ? "past" : "", chapterStarts.has(d) ? "chapter-start" : ""].filter(Boolean).join(" ");
    cells.push(`<span class="${cls}" title="${esc(t.name)} ${d}"></span>`);
  }
  const si = sederIndex(t.seder);
  return `<div class="mini" role="img" aria-label="Day ${ref.dayInCycle} of ${CYCLE_LENGTH} in the Talmud; daf ${ref.daf} of ${t.lastDaf} in ${esc(t.name)}">
  <span class="mini-cap">The Talmud</span><div class="mini-bar orders">${orders}${mark}</div><span class="mini-val">Day ${ref.dayInCycle.toLocaleString("en-US")} of ${CYCLE_LENGTH.toLocaleString("en-US")}</span>
  <span class="mini-cap">${esc(t.name)}</span><div class="mini-bar dapim s${si + 1}">${cells.join("")}</div><span class="mini-val">Daf ${ref.daf} of ${t.lastDaf}</span>
</div>`;
}
