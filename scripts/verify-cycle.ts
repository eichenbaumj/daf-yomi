/**
 * Compare our offline schedule to Sefaria's Daf Yomi calendar for every date
 * from a start date (default today) to the end of the current cycle, plus a
 * sample of past dates. Any mismatch is a launch blocker.
 *
 *   npm run verify:cycle            # today → cycle end
 *   npm run verify:cycle -- --from 2020-01-05 --to 2020-03-01
 *   npm run verify:cycle -- --sample 60     # 60 evenly spaced dates across the range
 *   npm run verify:cycle -- --delay 1500    # ms between requests (default 1200; Sefaria throttles bursts)
 */
import { dafForDate, cycleEndDate, addDays, ymd, parseYmd } from "../src/daf/schedule";

const UA = "daf-yomi-site verify script (joe@group17a.com)";
const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };

/** Sefaria displayValue → our slug/daf, e.g. "Bekhorot 2", "Shekalim 4", "Mishnah Kinnim 2:1-3:1" is displayed as "Kinnim 23"? We compare loosely. */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/^(mishnah|jerusalem talmud)\s+/, "").replace(/[^a-z]/g, "");
}

async function sefariaDaf(d: Date): Promise<{ name: string; daf: number } | null> {
  const url = `https://www.sefaria.org/api/calendars?year=${d.getFullYear()}&month=${d.getMonth() + 1}&day=${d.getDate()}&timezone=UTC`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 15000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const j: any = await res.json();
    const item = (j.calendar_items ?? []).find((i: any) => i?.title?.en === "Daf Yomi");
    if (!item) return null;
    const m = /^(.*?)\s+(\d+)$/.exec(String(item.displayValue?.en ?? ""));
    if (!m) return { name: String(item.displayValue?.en), daf: NaN };
    return { name: m[1]!, daf: Number(m[2]) };
  }
  throw new Error(`gave up on ${url}`);
}

async function main() {
  const today = new Date(); const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const from = parseYmd(opt("from") ?? "") ?? t0;
  const to = parseYmd(opt("to") ?? "") ?? cycleEndDate(dafForDate(t0).cycle);
  const sample = Number(opt("sample") ?? 0);
  const delay = Number(opt("delay") ?? 1200);
  let dates: Date[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  if (sample > 0 && sample < dates.length) {
    const step = dates.length / sample;
    dates = Array.from({ length: sample }, (_, i) => dates[Math.floor(i * step)]!);
  }
  let ok = 0; const bad: string[] = [];
  for (const d of dates) {
    const ours = dafForDate(d);
    const theirs = await sefariaDaf(d);
    const match = theirs && normalizeName(theirs.name) === normalizeName(ours.tractate.name) && theirs.daf === ours.daf;
    if (match) ok++;
    else bad.push(`${ymd(d)}: ours=${ours.tractate.name} ${ours.daf} sefaria=${theirs ? `${theirs.name} ${theirs.daf}` : "none"}`);
    if ((ok + bad.length) % 50 === 0) process.stderr.write(`${ok + bad.length}/${dates.length} checked, ${bad.length} mismatches\n`);
    await new Promise((r) => setTimeout(r, delay)); // Sefaria throttles bursts of ~75 requests
  }
  console.log(`${ok}/${dates.length} agree with Sefaria's calendar (${ymd(from)} → ${ymd(to)})`);
  if (bad.length) { console.log("MISMATCHES:"); for (const b of bad) console.log("  " + b); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
