import type { Env } from "../types";
import { dafLabel, dafPath } from "../daf/tractates";
import { longDate, type DafRef } from "../daf/schedule";
import type { DafNote } from "../note/store";
import { esc } from "./layout";

export interface FeedItem { date: Date; ref: DafRef; note: DafNote | null }

function rfc822(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 4, 0, 0)).toUTCString();
}

export function renderFeed(env: Env, origin: string, items: FeedItem[]): string {
  const entries = items.map(({ date, ref, note }) => {
    const label = dafLabel(ref.tractate, ref.daf);
    const url = `${origin}${dafPath(ref.tractate, ref.daf)}`;
    const desc = note
      ? `<p>${esc(note.summary)}</p><p><em>${esc(note.question)}</em></p><p><small>AI note, written from the English text. Not a scholar.</small></p>`
      : `<p>Today's daf is ${esc(label)}. The AI note for it is not written yet.</p>`;
    return `<item>
  <title>${esc(label)} · ${esc(longDate(date))}</title>
  <link>${esc(url)}</link>
  <guid isPermaLink="true">${esc(url)}</guid>
  <pubDate>${rfc822(date)}</pubDate>
  <description>${esc(desc)}</description>
</item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(env.SITE_NAME)}</title>
  <link>${esc(origin)}/</link>
  <atom:link href="${esc(origin)}/feed.xml" rel="self" type="application/rss+xml"/>
  <description>${esc(env.SITE_TAGLINE)}</description>
  <language>en</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  ${entries.join("\n")}
</channel>
</rss>
`;
}
