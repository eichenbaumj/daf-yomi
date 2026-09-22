import type { Env } from "../types";
import { smartenText } from "./typography";
import { dafPath } from "../daf/tractates";
import type { DafRef } from "../daf/schedule";
import type { DafNote } from "../note/store";
import { currentTranslation, type TranslatedNote } from "../note/tstore";
import { p, type Lang } from "../i18n/strings";
import { dafLabelL, longDateL, strings } from "../i18n/format";
import { esc } from "./layout";

export interface FeedItem { date: Date; ref: DafRef; note: DafNote | null; translation?: TranslatedNote | null }

function rfc822(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 4, 0, 0)).toUTCString();
}

export function renderFeed(env: Env, origin: string, items: FeedItem[], lang: Lang = "en"): string {
  const S = strings(lang);
  const curly = (s: string) => (lang === "en" ? smartenText(s) : s);
  const entries = items.map(({ date, ref, note, translation }) => {
    const label = dafLabelL(lang, ref.tractate, ref.daf);
    const url = `${origin}${p(lang, dafPath(ref.tractate, ref.daf))}`;
    const shown = lang === "en" ? note : currentTranslation(note, translation ?? null);
    const desc = shown
      ? `<p>${esc(curly(shown.summary))}</p><p><em>${esc(curly(shown.question))}</em></p><p><small>${esc(curly(S.feedAiSmall))}</small></p>`
      : `<p>${esc(S.feedNoNote(label))}</p>`;
    return `<item>
  <title>${esc(label)} · ${esc(longDateL(lang, date))}</title>
  <link>${esc(url)}</link>
  <guid isPermaLink="true">${esc(url)}</guid>
  <pubDate>${rfc822(date)}</pubDate>
  <description>${esc(desc)}</description>
</item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(smartenText(env.SITE_NAME))}</title>
  <link>${esc(origin)}${p(lang, "/")}</link>
  <atom:link href="${esc(origin)}${p(lang, "/feed.xml")}" rel="self" type="application/rss+xml"/>
  <description>${esc(curly(env.SITE_TAGLINE))}</description>
  <language>${lang}</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  ${entries.join("\n")}
</channel>
</rss>
`;
}
