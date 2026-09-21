/**
 * The daily issue as an email. One pure function from (daf, date, note) to
 * subject, preheader, HTML and plain text; no I/O and nothing fetched from
 * Sefaria (a test greps this file for the client module), so an outage at the
 * source cannot stop the morning email.
 *
 * Design notes, decided 2026-09-20 (see the plan): the note is the whole
 * issue and the question is the last thing read inside the card; fluid-hybrid
 * 600 px tables; parchment colours forced light (Gmail's apps honour
 * `color-scheme: light only`; classic Outlook inverts and stays legible); no
 * images; one Hebrew run (the tractate title) behind a flag; gold is never
 * text. Per-reader values are placeholders substituted by personalize().
 */
import { esc } from "./layout";
import { AI_LABEL, LEGEND } from "./dafPage";
import { SEDARIM } from "./dafYomiDiagram";
import { dafLabel, dafPath, type Tractate } from "../daf/tractates";
import { hebrewDate, longDate, type DafRef } from "../daf/schedule";
import type { DafNote } from "../note/store";

export const PLACEHOLDERS = {
  unsub: "__UNSUB__",
  prefs: "__PREFS__",
  email: "__EMAIL__",
  confirmed: "__CONFIRMED__",
  heldHtml: "<!--HELD-->",
  heldText: "[HELD]",
} as const;

export interface IssueModel {
  /** https://daf-yomi.dev */
  origin: string;
  siteName: string;
  ref: DafRef;
  /** Civil date of the daf. */
  date: Date;
  note: DafNote | null;
  /** Show the Hebrew tractate title (the email's only right-to-left run). */
  hebrew: boolean;
}
export interface RenderedIssue { subject: string; preheader: string; html: string; text: string }

export interface Personal {
  unsubUrl: string;
  prefsUrl: string;
  email: string;
  confirmedDate: string;
  /** Pre-rendered "held for Shabbat" row and lines, or empty strings. */
  heldHtml: string;
  heldText: string;
}

// ---- tokens (public/styles.css) ----
const PAPER = "#f3ead7", PAPER2 = "#e8dcc2", NOTE_BG = "#f8f0dc", INK = "#2b2118", INK2 = "#66563f", RULE = "#d3c2a0", ACCENT = "#8b2e1f", ACCENT_DARK = "#6e2418", GOLD = "#a9812f";
const SERIF = `'Source Serif 4','Iowan Old Style','Palatino Linotype',Palatino,Georgia,'Times New Roman',serif`;
const HEBREW = `'Frank Ruhl Libre','Noto Serif Hebrew','Times New Roman',David,FrankRuehl,Narkisim,'Arial Hebrew',serif`;
const FONTS_URL = "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&family=Frank+Ruhl+Libre:wght@400&display=swap";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Sunday, 20 September": the subject's date, without the year (34 to 38 characters with the daf; phones show about 40). */
export function subjectDate(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** The site's AI label with its one deictic changed for a medium where the page is not underneath the words. */
export function aiLabel(medium: "web" | "email"): string {
  return medium === "web" ? AI_LABEL : AI_LABEL.replace("on this page", "of this daf, linked below");
}

/** The site's legend for mishna / Gemara / baraita, as one plain sentence. */
export function legendSentence(): string {
  const plain = LEGEND.replace(/<[^>]+>/g, "");
  const i = plain.indexOf("A mishna");
  return i >= 0 ? plain.slice(i).trim() : plain;
}
function mentionsLegendTerms(...texts: string[]): boolean {
  return /\b(mishna|gemara|baraita)\b/i.test(texts.join(" "));
}

export function firstSentence(s: string): string {
  const m = /^[\s\S]*?[.?!](?=\s|$)/.exec(s.trim());
  return (m ? m[0] : s).trim();
}

function sefariaUrl(t: Tractate, daf: number): string {
  const title = t.sefariaTitle.replace(/ /g, "_");
  return t.refMode === "talmud" ? `https://www.sefaria.org/${title}.${daf}a?lang=bi` : `https://www.sefaria.org/${title}`;
}

/** Version-aware attribution without any fetch: the three calendar-mode tractates are known in the table. */
export function attribution(t: Tractate): { html: string; text: string } {
  if (t.refMode !== "talmud") {
    const what = t.slug === "shekalim"
      ? `the Jerusalem Talmud in Heinrich Guggenheimer's translation (CC BY)`
      : `the Mishnah`;
    const text = `The text for ${t.name} is ${what}, served by Sefaria; the page credits the exact version.`;
    return { html: `The text for ${esc(t.name)} is ${esc(what)}, served by <a href="https://www.sefaria.org" style="color:${ACCENT};">Sefaria</a>; the page credits the exact version.`, text };
  }
  return {
    html: `The text is <a href="https://www.sefaria.org/william-davidson-talmud" style="color:${ACCENT};">The William Davidson Talmud</a>: Rabbi Adin Even-Israel Steinsaltz's (1937 to 2020) English translation and explanation (Koren Noé edition), published by Koren Publishers and served by <a href="https://www.sefaria.org" style="color:${ACCENT};">Sefaria</a> under <a href="https://creativecommons.org/licenses/by-nc/4.0/" style="color:${ACCENT};">CC BY-NC 4.0</a>.`,
    text: `The text is The William Davidson Talmud (https://www.sefaria.org/william-davidson-talmud): Rabbi Adin Even-Israel Steinsaltz's (1937 to 2020) English translation and explanation (Koren Noé edition), published by Koren Publishers and served by Sefaria (https://www.sefaria.org) under CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/).`,
  };
}

function sederGloss(t: Tractate): string {
  const s = SEDARIM.find((x) => x.name === t.seder);
  if (!s) return "";
  const g = s.gloss.replace(/\s*\([^)]*\)\s*$/, "");
  return g.charAt(0).toLowerCase() + g.slice(1);
}

function roundWords(n: number): string {
  const r = n >= 1000 ? Math.round(n / 100) * 100 : Math.round(n / 10) * 10;
  return r.toLocaleString("en-US");
}

/** Wrap plain text at ~72 columns, paragraph by paragraph. */
export function wrap(text: string, width = 72): string {
  return text.split("\n").map((line) => {
    if (line.length <= width || /^https?:\/\//.test(line.trim())) return line;
    const words = line.split(" ");
    const out: string[] = [];
    let cur = "";
    for (const w of words) {
      if (cur && (cur + " " + w).length > width) { out.push(cur); cur = w; }
      else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) out.push(cur);
    return out.join("\n");
  }).join("\n");
}

export function noNoteText(label: string): string {
  return `The note for ${label} was not written in time. The AI failed its own checks twice, or the text could not be fetched. The page is still there.`;
}

// ---- HTML fragments ----
const td = (extra: string, inner: string) => `<tr><td dir="ltr" ${extra}>${inner}</td></tr>`;
const muteStyle = (size: number, lh: number) => `font-family:${SERIF};font-size:${size}px;line-height:${lh}px;color:${INK2};`;
const link = (href: string, label: string) => `<a href="${esc(href)}" style="color:${ACCENT};">${label}</a>`;
const dot = `<span style="color:${GOLD};" aria-hidden="true">&middot;</span>`;

export function renderIssue(m: IssueModel): RenderedIssue {
  const t = m.ref.tractate;
  const daf = m.ref.daf;
  const label = dafLabel(t, daf);
  const permalink = `${m.origin}${dafPath(t, daf)}`;
  const note = m.note;
  const subject = `${label} · ${subjectDate(m.date)}`;
  const lastDaf = daf === t.lastDaf ? `Last daf of ${t.name}. ` : "";
  const preheader = note ? `${lastDaf}${firstSentence(note.summary)}` : `${lastDaf}${label}. The page is ready; the note for it was not written in time.`;
  const gloss = sederGloss(t);
  const positionText = `A daf is one leaf, both sides · ${t.seder}${gloss ? ` (${gloss})` : ""} · Day ${m.ref.dayInCycle.toLocaleString("en-US")} of 2,711`;
  const tractateText = `${t.name}, one of the Talmud's 40 tractates (books), daf ${daf} of ${t.lastDaf}. ${t.shortDesc}`;
  const dateText = `${longDate(m.date)} · ${hebrewDate(m.date)}`;
  const legend = note && mentionsLegendTerms(note.summary, note.question) ? legendSentence() : "";
  const words = note?.wordCount ? `The whole daf in English, about ${roundWords(note.wordCount)} words today, with the Hebrew and Aramaic one tap away.` : "The whole daf in English, with the Hebrew and Aramaic one tap away.";
  const sefaria = sefariaUrl(t, daf);
  const hadran = t.hadranSlug;
  const hadranUrl = hadran ? `https://hadran.org.il/daf/${hadran}-${daf}/` : null;
  const attr = attribution(t);
  const aiSentence = "The note above is written by an AI and says so. It may quote only words that are on the page, may not cite later authorities, and may not state a ruling as practice.";
  const consentText = `You asked for this at daf-yomi.dev and confirmed ${PLACEHOLDERS.email} on ${PLACEHOLDERS.confirmed}. It is sent automatically at the hour you chose, from a schedule set in advance; nobody presses send. Replies reach me, not the AI.`;
  const privacyUrl = `${m.origin}/newsletter/privacy`;
  const aboutUrl = `${m.origin}/about`;

  // --- note card ---
  const quotesLine = note && note.quotes.length
    ? `<p class="mute" style="margin:0 0 16px;${muteStyle(15, 23)}">From the page: ${note.quotes.map((q) => `&ldquo;${esc(q)}&rdquo;`).join(` ${dot} `)}</p>`
    : "";
  const card = note
    ? `<p class="mute" style="margin:0 0 14px;${muteStyle(13, 19)}"><span class="ox" style="font-weight:700;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${ACCENT};">AI note</span>&nbsp; ${esc(aiLabel("email"))}</p>
<p class="sum ink" style="margin:0 0 18px;font-family:${SERIF};font-size:19px;line-height:30px;color:${INK};">${esc(note.summary)}</p>
${quotesLine}<table role="presentation" cellpadding="0" cellspacing="0" border="0" aria-hidden="true"><tr><td width="40" style="width:40px;border-top:1px solid ${GOLD};font-size:0;line-height:0;">&nbsp;</td></tr></table>
<p class="q ink" style="margin:16px 0 0;font-family:${SERIF};font-size:19px;line-height:28px;font-style:italic;color:${INK};"><span style="color:${GOLD};font-size:14px;font-style:normal;" aria-hidden="true">&#10022;</span>&nbsp; ${esc(note.question)}</p>`
    : `<p class="mute" style="margin:0 0 14px;${muteStyle(13, 19)}"><span class="ox" style="font-weight:700;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${ACCENT};">AI note</span>&nbsp; ${esc(aiLabel("email"))}</p>
<p class="sum ink" style="margin:0;font-family:${SERIF};font-size:18px;line-height:28px;color:${INK};">${esc(noNoteText(label))}</p>`;

  const hebrewSpan = m.hebrew ? ` <span lang="he" dir="rtl" style="font-family:${HEBREW};font-size:24px;font-weight:400;color:${INK2};unicode-bidi:isolate;">${esc(t.heTitle)}</span>` : "";

  const html = `<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<!--[if !mso]><!--><link rel="stylesheet" href="${FONTS_URL}"><!--<![endif]-->
<style>
html,body{margin:0 auto!important;padding:0!important;width:100%!important}
*{-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%}
table,td{mso-table-lspace:0pt!important;mso-table-rspace:0pt!important}
u+#body a{color:inherit;text-decoration:none;font-size:inherit;font-family:inherit;font-weight:inherit;line-height:inherit}
@media screen and (max-width:600px){
.pad{padding:20px 14px!important}
.card{padding:16px 16px 20px!important}
.h1{font-size:26px!important;line-height:32px!important}
.sum{font-size:18px!important;line-height:28px!important}
.q{font-size:18px!important;line-height:27px!important}
.row{display:block!important;padding:6px 0!important}
}
</style>
<style>
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}
@media (prefers-color-scheme:dark){
.bg{background-color:${PAPER}!important}.bg2{background-color:${PAPER2}!important}.note{background-color:${NOTE_BG}!important}
.ink{color:${INK}!important}.mute{color:${INK2}!important}.ox{color:${ACCENT}!important}
}
[data-ogsb] .bg{background-color:${PAPER}!important}[data-ogsb] .bg2{background-color:${PAPER2}!important}[data-ogsb] .note{background-color:${NOTE_BG}!important}
[data-ogsc] .ink{color:${INK}!important}[data-ogsc] .mute{color:${INK2}!important}[data-ogsc] .ox{color:${ACCENT}!important}
</style>
</head>
<body id="body" class="bg" xml:lang="en" bgcolor="${PAPER}" style="margin:0;padding:0;word-spacing:normal;background-color:${PAPER};">
<div role="article" aria-roledescription="email" aria-label="${esc(m.siteName)}: ${esc(label)}" lang="en" dir="ltr" class="bg" style="background-color:${PAPER};font-size:medium;font-size:max(16px,1rem);">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;" aria-hidden="true">${esc(preheader)}${"&zwnj;&nbsp;".repeat(12)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="${PAPER}" style="background-color:${PAPER};">
<tr><td align="center" dir="ltr" class="pad" style="padding:28px 12px 6px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<div style="max-width:600px;margin:0 auto;text-align:left;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:0 0 12px;border-bottom:1px solid ${RULE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td dir="ltr" class="ink" style="font-family:${SERIF};font-size:16px;line-height:22px;font-weight:600;color:${INK};">${WORDMARK_HTML}</td>
<td dir="ltr" align="right" style="font-family:${SERIF};font-size:14px;line-height:22px;"><a href="${PLACEHOLDERS.prefs}" style="color:${INK2};text-decoration:underline;">Settings</a></td>
</tr></table></td></tr>
${td(`class="mute" style="padding:22px 0 6px;${muteStyle(15, 22)}"`, `${esc(longDate(m.date))} ${dot} ${esc(hebrewDate(m.date))}`)}
${td(`style="padding:0 0 8px;"`, `<h1 class="h1 ink" style="margin:0;font-family:${SERIF};font-size:30px;line-height:36px;font-weight:700;letter-spacing:-.3px;color:${INK};">${esc(label)}${hebrewSpan}</h1>`)}
${td(`class="mute" style="padding:0 0 4px;${muteStyle(15, 22)}"`, esc(tractateText))}
${td(`class="mute" style="padding:0 0 22px;${muteStyle(14, 21)}"`, `A daf is one leaf, both sides ${dot} ${esc(t.seder)}${gloss ? ` (${esc(gloss)})` : ""} ${dot} Day ${m.ref.dayInCycle.toLocaleString("en-US")} of 2,711`)}
<tr><td class="note" bgcolor="${NOTE_BG}" style="background-color:${NOTE_BG};border:1px solid ${RULE};border-top:3px solid ${GOLD};border-radius:3px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td dir="ltr" class="card" style="padding:18px 22px 22px;">
${card}
</td></tr></table></td></tr>
${legend ? td(`class="mute" style="padding:12px 4px 0;${muteStyle(13, 19)}"`, esc(legend)) : ""}
${PLACEHOLDERS.heldHtml}
<tr><td align="center" style="padding:26px 0 8px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${ACCENT}" style="background-color:${ACCENT};border:1px solid ${ACCENT_DARK};border-radius:3px;"><a href="${esc(permalink)}" style="display:block;padding:14px 28px;font-family:${SERIF};font-size:17px;line-height:20px;font-weight:600;color:${PAPER};text-decoration:none;">Read ${esc(label)} in English</a></td></tr></table></td></tr>
${td(`align="center" class="mute" style="padding:0 0 22px;${muteStyle(13, 18)}"`, esc(words))}
${td(`align="center" class="mute" style="padding:0 0 28px;${muteStyle(14, 22)}"`, `The text on ${link(sefaria, "Sefaria")}, the free online library it comes from.${hadranUrl ? ` ${dot} Today's class on ${link(hadranUrl, "Hadran")}, Rabbanit Michelle Farber's daily Daf Yomi teaching site.` : ""}`)}
</table></div>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
<tr><td align="center" dir="ltr" class="pad bg2" bgcolor="${PAPER2}" style="padding:22px 12px 34px;background-color:${PAPER2};border-top:1px solid ${RULE};">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<div style="max-width:600px;margin:0 auto;text-align:left;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" aria-hidden="true" style="padding:0 0 16px;font-family:${SERIF};font-size:12px;line-height:16px;letter-spacing:8px;color:${GOLD};">&#10022;&#10022;&#10022;</td></tr>
<tr><td dir="ltr" class="mute" style="${muteStyle(13, 20)}">
<p style="margin:0 0 10px;">${attr.html}</p>
<p style="margin:0 0 10px;">${esc(aiSentence)} ${link(aboutUrl, "How this works.")}</p>
<p style="margin:0 0 14px;">${esc(consentText)}</p>
</td></tr>
<tr><td dir="ltr" style="font-family:${SERIF};font-size:14px;line-height:28px;">
<a class="row" href="${PLACEHOLDERS.unsub}" style="color:${ACCENT};display:inline-block;padding:0 12px 0 0;">Unsubscribe</a>
<a class="row" href="${PLACEHOLDERS.prefs}" style="color:${ACCENT};display:inline-block;padding:0 12px 0 0;">Change the hour or time zone</a>
<a class="row" href="${esc(permalink)}" style="color:${ACCENT};display:inline-block;padding:0 12px 0 0;">Read on the web</a>
<a class="row" href="${esc(privacyUrl)}" style="color:${ACCENT};display:inline-block;">Privacy</a>
</td></tr>
${td(`class="mute" style="padding:14px 0 0;${muteStyle(13, 20)}"`, `Free, no accounts, no tracking pixel. ${esc(m.siteName)}, daf-yomi.dev. A good day of learning to you.`)}
</table></div>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>
`;

  const textCard = note
    ? `AI NOTE. ${aiLabel("email")}\n\n${note.summary}\n${note.quotes.length ? `\nFrom the page: ${note.quotes.map((q) => `“${q}”`).join(" · ")}\n` : ""}\n✦ ${note.question}`
    : `AI NOTE. ${aiLabel("email")}\n\n${noNoteText(label)}`;
  const text = wrap([
    WORDMARK_TEXT,
    dateText,
    "",
    `${label.toUpperCase()}${m.hebrew ? ` · ${t.heTitle}` : ""}`,
    tractateText,
    positionText,
    "",
    textCard,
    legend ? `\n${legend}` : "",
    "",
    `Read ${label} in English: ${permalink}`,
    words,
    "",
    `The text on Sefaria, the free online library it comes from: ${sefaria}`,
    hadranUrl ? `Today's class on Hadran, Rabbanit Michelle Farber's daily Daf Yomi teaching site: ${hadranUrl}` : "",
    PLACEHOLDERS.heldText,
    "",
    "✦ ✦ ✦",
    "",
    attr.text,
    "",
    `${aiSentence} How this works: ${aboutUrl}`,
    "",
    consentText,
    "",
    `Unsubscribe: ${PLACEHOLDERS.unsub}`,
    `Change the hour or time zone: ${PLACEHOLDERS.prefs}`,
    `Read on the web: ${permalink}`,
    `Privacy: ${privacyUrl}`,
    "",
    `Free, no accounts, no tracking pixel. ${m.siteName}, daf-yomi.dev. A good day of learning to you.`,
  ].filter((line) => line !== null).join("\n").replace(/\n{3,}/g, "\n\n"));

  return { subject, preheader, html, text };
}

/** Substitute the per-reader placeholders. Tokens are hex; the address and dates go through esc() for HTML. */
export function personalize(r: RenderedIssue, p: Personal): RenderedIssue {
  const rep = (s: string, isHtml: boolean) => s
    .split(PLACEHOLDERS.unsub).join(isHtml ? esc(p.unsubUrl) : p.unsubUrl)
    .split(PLACEHOLDERS.prefs).join(isHtml ? esc(p.prefsUrl) : p.prefsUrl)
    .split(PLACEHOLDERS.email).join(isHtml ? esc(p.email) : p.email)
    .split(PLACEHOLDERS.confirmed).join(isHtml ? esc(p.confirmedDate) : p.confirmedDate);
  const html = rep(r.html, true).replace(PLACEHOLDERS.heldHtml, p.heldHtml);
  const text = rep(r.text, false).replace(PLACEHOLDERS.heldText + "\n", p.heldText ? `${p.heldText}\n` : "").replace(PLACEHOLDERS.heldText, p.heldText);
  return { ...r, html, text };
}

/** The "held for Shabbat" row, for readers who asked for it, listing the dapim their held issues would have carried. */
export function heldBlock(origin: string, held: { date: Date; ref: DafRef }[]): { html: string; text: string } {
  if (!held.length) return { html: "", text: "" };
  const items = held.map((h) => ({ label: dafLabel(h.ref.tractate, h.ref.daf), url: `${origin}${dafPath(h.ref.tractate, h.ref.daf)}`, date: longDate(h.date) }));
  const html = td(`class="mute" style="padding:14px 4px 0;${muteStyle(14, 21)}"`, `Held for Shabbat and Yom Tov, as you asked: ${items.map((i) => `${link(i.url, esc(i.label))} (${esc(i.date)})`).join(", ")}.`);
  const text = `Held for Shabbat and Yom Tov, as you asked: ${items.map((i) => `${i.label} (${i.date}) ${i.url}`).join("; ")}.`;
  return { html, text };
}

// ---- confirmation email (double opt-in) ----
/** The wordmark, as on the site header: "Daf Yomi" carrying the weight, "Dot Dev" small beside it. */
const WORDMARK_HTML = `<span style="color:${GOLD};font-size:12px;" aria-hidden="true">&#10022;</span>&nbsp; Daf Yomi <span style="font-weight:400;font-size:12px;color:${INK2};letter-spacing:.04em;">Dot Dev</span>`;
const WORDMARK_TEXT = "DAF YOMI DOT DEV";

export interface ConfirmModel { origin: string; siteName: string; confirmUrl: string; hourLabel: string; tz: string; editionLabel: string }
export function renderConfirmEmail(c: ConfirmModel): RenderedIssue {
  const subject = `Confirm your ${c.siteName} email`;
  const body = `You asked for the daf by email at daf-yomi.dev: ${c.editionLabel}, at ${c.hourLabel} in ${c.tz}. If that was you, click below. If not, ignore this; nothing more will come.`;
  const tail = "The link works once and for 48 hours. Nothing is sent until you click it.";
  const html = `<!DOCTYPE html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body id="body" bgcolor="${PAPER}" style="margin:0;padding:0;background-color:${PAPER};">
<div role="article" aria-roledescription="email" lang="en" dir="ltr" style="background-color:${PAPER};font-size:medium;font-size:max(16px,1rem);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background-color:${PAPER};"><tr><td align="center" dir="ltr" style="padding:28px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<div style="max-width:600px;margin:0 auto;text-align:left;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${td(`class="ink" style="padding:0 0 12px;border-bottom:1px solid ${RULE};font-family:${SERIF};font-size:16px;line-height:22px;font-weight:600;color:${INK};"`, WORDMARK_HTML)}
${td(`style="padding:22px 0 8px;"`, `<h1 style="margin:0;font-family:${SERIF};font-size:26px;line-height:32px;font-weight:700;color:${INK};">One click to confirm</h1>`)}
${td(`style="padding:0 0 22px;font-family:${SERIF};font-size:18px;line-height:28px;color:${INK};"`, esc(body))}
<tr><td align="left" style="padding:0 0 22px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${ACCENT}" style="background-color:${ACCENT};border:1px solid ${ACCENT_DARK};border-radius:3px;"><a href="${esc(c.confirmUrl)}" style="display:block;padding:14px 28px;font-family:${SERIF};font-size:17px;line-height:20px;font-weight:600;color:${PAPER};text-decoration:none;">Yes, send me the daf</a></td></tr></table></td></tr>
${td(`style="${muteStyle(14, 21)}"`, esc(tail))}
${td(`style="padding:18px 0 0;${muteStyle(13, 20)}"`, `If the button does not work, open this link: <a href="${esc(c.confirmUrl)}" style="color:${ACCENT};word-break:break-all;">${esc(c.confirmUrl)}</a>`)}
</table></div>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></div></body></html>
`;
  const text = wrap([WORDMARK_TEXT, "", "ONE CLICK TO CONFIRM", "", body, "", `Yes, send me the daf: ${c.confirmUrl}`, "", tail].join("\n"));
  return { subject, preheader: body, html, text };
}
