import type { Env } from "../types";
import { esc, page } from "./layout";
import { renderDafYomiDiagram } from "./dafYomiDiagram";
import type { DafRef } from "../daf/schedule";
import type { Lang } from "../i18n/strings";
import { strings } from "../i18n/format";
import { aboutBodyHe } from "./aboutHe";

export function renderAbout(env: Env, origin: string, today: DafRef, lang: Lang = "en"): string {
  const S = strings(lang);
  const body = lang === "he" ? aboutBodyHe(env, today) : `
<article class="prose">
  <header class="daf-head"><h1>About</h1></header>

  <p>I wanted a page that shows me the day's daf in English, tells me where it sits in the Talmud, and gives me one thing to think about. Everything I found was either Hebrew-first or an email longer than the daf.</p>

  <h2>What you get</h2>
  <ul>
    <li><strong>The whole daf, in English.</strong> The translation is by Rabbi Adin Even-Israel Steinsaltz (1937 to 2020), a Jerusalem rabbi who spent most of his working life turning the Talmud into modern Hebrew and English so that anyone could read it. In his edition the bold words are the Talmud's own and the regular text is his explanation woven through. The Hebrew and Aramaic are one tap away. So is a "Talmud only" view that hides the explanation.</li>
    <li><strong>Where you are.</strong> The Seder, the tractate, the chapter, the daf, and the day of the 2,711-day cycle.</li>
    <li><strong>A short note, written by an AI.</strong> Two or three sentences on what the page argues about, and one question with no settled answer. It is labelled as an AI note every single time, because that is what it is.</li>
    <li><strong>A permalink for every daf</strong>, so yesterday is one tap back and any page can be shared.</li>
  </ul>

  <h2>How Daf Yomi works</h2>
  <p>Daf Yomi ("a page a day") is a shared reading schedule: one leaf of the Babylonian Talmud every day, in print order, until you have read all of it. Then you start again. It was proposed by Rabbi Meir Shapiro in 1923 and has run continuously since.</p>
  ${renderDafYomiDiagram(today)}

  <h2>About the AI note</h2>
  <p>The note is written each night by Claude, a large language model made by Anthropic, from the English text of that day's daf and nothing else. It is not a rabbi. It is not a scholar. It has not read Rashi. It is asked to summarize and to raise a question, not to tell you what the page means or what you should do.</p>
  <p>I have hardcoded a few core principles into how Claude interprets Talmud. AI-generated notes may quote only phrases that appear word for word in the text; they may not cite later authorities; they may not state a halachic ruling as practice. If, in the process of constructing an AI note, Claude fails those checks twice, the page shows no note that day. The style the AI notes are written in is a house style that will keep changing. If a note is off, <a href="mailto:joe@group17a.com">tell me</a>.</p>
  <p>If you want real teaching, every daf page links to <a href="https://hadran.org.il" rel="noopener">Hadran</a>, <a href="https://www.dafyomi.co.il/" rel="noopener">Kollel Iyun Hadaf</a>, and the <a href="https://steinsaltz.org/todays-daf/" rel="noopener">Steinsaltz Center</a>. They are the scholars. This is a door.</p>

  <h2>Where the text comes from</h2>
  <p>Every word of Talmud on this site is served live from <a href="https://www.sefaria.org" rel="noopener">Sefaria</a>'s open API. The Babylonian Talmud is <a href="https://www.sefaria.org/william-davidson-talmud" rel="noopener">The William Davidson Talmud</a> (Koren Noé edition), released by Koren Publishers under a <a href="https://creativecommons.org/licenses/by-nc/4.0/" rel="noopener">Creative Commons BY-NC 4.0</a> license. The 21 days of Shekalim use the Jerusalem Talmud in Heinrich Guggenheimer's translation (CC BY), and the Kinnim and Middot days use the Mishnah, as the Daf Yomi calendar does; those pages credit their own versions. Nothing on this site is sold and nothing is behind a login.</p>

  <h2>Which day is it</h2>
  <p>The daf follows the civil date where you are, the same convention Sefaria, Hebcal, and the printed calendars use. If you learn after nightfall and want to be a day ahead, the next daf is one tap away at the bottom of every page.${env.NEWSLETTER_PUBLIC === "1" ? ` If you would rather have it come to you, <a href="/newsletter">the daf by email</a> arrives once a day at the hour you choose.` : ""}</p>

  <h2>Who</h2>
  <p>Joe Eichenbaum. I'm a partner at a consulting firm that works with state and local governments, and I build things on the side. The code is <a href="https://github.com/eichenbaumj/daf-yomi" rel="noopener">open on GitHub</a>; the site costs almost nothing to run, so it will stay free. Corrections, complaints, and ideas: <a href="mailto:${esc("joe@group17a.com")}">joe@group17a.com</a>.</p>
</article>`;
  return page({ env, origin, lang, title: S.aboutTitle, description: S.aboutDescription, canonicalPath: "/about", body });
}
