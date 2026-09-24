/**
 * The site pages around the newsletter: the form, the confirmation and
 * goodbye notices, the preferences page and the privacy page. Same chrome as
 * the rest of the site (page()), Joe's voice, no em dashes.
 */
import type { Env } from "../types";
import { esc, page } from "./layout";
import type { SubscriberRow } from "../newsletter/db";

export const CONSENT_VERSION = "2026-09-v1";

const TZ_SCRIPT = `<script>try{var z=Intl.DateTimeFormat().resolvedOptions().timeZone,s=document.querySelector('select[name=tz]');if(z&&s&&!s.dataset.chosen){if(![].some.call(s.options,function(o){return o.value===z})){var o=document.createElement('option');o.value=z;o.textContent=z;s.appendChild(o)}s.value=z}}catch(e){}</script>`;

function tzSelect(options: string[], selected: string, chosen = false): string {
  const all = options.includes(selected) ? options : [...options, selected];
  return `<select name="tz"${chosen ? ' data-chosen="1"' : ""}>${all.map((z) => `<option value="${esc(z)}"${z === selected ? " selected" : ""}>${esc(z.replace(/_/g, " "))}</option>`).join("")}</select>`;
}

/**
 * Head script for the inline box. Turnstile is rendered explicitly, the first time the box is opened,
 * because a widget rendered inside a closed <details> measures a zero-width container. The zone field
 * is filled from the browser; the server default stands if none of this runs.
 */
const INLINE_SCRIPT = `<script>(function(){var d=document.querySelector('details.note-subscribe');if(!d)return;try{var z=Intl.DateTimeFormat().resolvedOptions().timeZone,i=d.querySelector('input[name=tz]');if(z&&i)i.value=z}catch(e){}var done=false;function go(){if(done||!d.open||!window.turnstile)return;var w=d.querySelector('.cf-turnstile');if(!w)return;done=true;turnstile.render(w,{sitekey:w.getAttribute('data-sitekey'),theme:'light',appearance:'interaction-only',size:'flexible'})}window.dafTurnstileReady=go;d.addEventListener('toggle',function(){if(d.open){go();var e=d.querySelector('input[type=email]');if(e)setTimeout(function(){e.focus()},0)}})})()</script>`;

/** What the daf page needs in <head> for the inline box: the Turnstile loader (explicit render) and the script above. */
export const INLINE_SUBSCRIBE_HEAD = `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=dafTurnstileReady" async defer></script>`;
/** The script goes at the end of the body so the <details> exists when it runs. */
export const INLINE_SUBSCRIBE_TAIL = INLINE_SCRIPT;

/**
 * The sign-up inside the AI note: the left "pillar" under the note's text, a folded <details> whose summary is
 * one quiet line. Open, it is the same POST as the full form with the choices collapsed to their defaults
 * (morning, the reader's own zone, no Shabbat hold); a link leads to the rest. Turnstile shows itself only
 * when it must. `hasNote` is kept for callers; the wording is the same either way.
 */
export function renderInlineSubscribe(o: { siteKey: string; defaultTz: string; hasNote: boolean }): string {
  void o.hasNote;
  return `<details class="note-subscribe">
  <summary><span class="note-subscribe-lead">Get the note as email</span></summary>
  <form method="post" action="/newsletter" novalidate>
    <div class="note-subscribe-row">
      <label class="sr-only" for="sub-email">Your email</label>
      <input id="sub-email" type="email" name="email" required autocomplete="email" inputmode="email" placeholder="your@email">
      <button type="submit" class="btn">Send me the daf</button>
    </div>
    <input type="hidden" name="slot" value="morning">
    <input type="hidden" name="tz" value="${esc(o.defaultTz)}">
    <input type="hidden" name="consent" value="${CONSENT_VERSION}">
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <div class="cf-turnstile" data-sitekey="${esc(o.siteKey)}"></div>
    <p class="muted small">Free. Arrives at 6 am your time; one click to stop. <a href="/newsletter">The evening edition and other settings.</a> A confirmation email comes first.</p>
  </form>
</details>`;
}

export interface FormState { email?: string; slot?: "morning" | "evening"; tz?: string; hold?: boolean; error?: string }

/** GET /newsletter. Cacheable: nothing in it is per visitor except the zone list order, which is fixed. */
export function renderNewsletterPage(env: Env, origin: string, o: { siteKey: string; tzOptions: string[]; defaultTz: string; state?: FormState }): string {
  const s = o.state ?? {};
  const body = `
<article class="prose subscribe">
  <header class="daf-head"><h1>The daf by email</h1></header>
  <p>One email a day. The day's daf, the AI note and its question, and a link to the full page. A ~40 second read. No accounts, nothing ever tracked, nothing ever sold. You will not start getting more digital advertisements for hard-copy Talmuds or other emerging Jewish technologies.</p>
  <form method="post" action="/newsletter" class="subscribe-form" novalidate>
    ${s.error ? `<p class="form-error" role="alert">${esc(s.error)}</p>` : ""}
    <label>Your email
      <input type="email" name="email" required autocomplete="email" inputmode="email" value="${esc(s.email ?? "")}">
    </label>
    <fieldset>
      <legend>When</legend>
      <label><input type="radio" name="slot" value="morning"${s.slot !== "evening" ? " checked" : ""}> Morning, 6 am: the day's daf</label>
      <label><input type="radio" name="slot" value="evening"${s.slot === "evening" ? " checked" : ""}> The evening before, 8 pm: tomorrow's daf</label>
    </fieldset>
    <label>Your time zone
      ${tzSelect(o.tzOptions, s.tz ?? o.defaultTz, Boolean(s.tz))}
    </label>
    <label class="check"><input type="checkbox" name="hold" value="1"${s.hold ? " checked" : ""}> Hold Shabbat and Yom Tov issues until after; the next issue lists what was held.</label>
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <input type="hidden" name="consent" value="${CONSENT_VERSION}">
    <div class="cf-turnstile" data-sitekey="${esc(o.siteKey)}" data-theme="light"></div>
    <button type="submit" class="btn">Send me the daf</button>
    <p class="muted small">I will send one message first to check the address is yours. Nothing arrives until you click it.</p>
  </form>
  <p class="muted small">The issues are sent automatically at the hour you chose, from a schedule set in advance; nobody presses send. <a href="/newsletter/privacy">What I keep, and why.</a> If a note is off, reply to any issue; replies reach me.</p>
</article>`;
  return page({
    env, origin, title: "The daf by email", canonicalPath: "/newsletter",
    description: "One email a day. The day's daf, the AI note and its question, and a link to the full page. Free, no accounts, one-click unsubscribe.",
    body, extraHead: `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>${TZ_SCRIPT}`,
    noLangSwitch: true,
  });
}

export function renderNewsletterClosed(env: Env, origin: string): string {
  const body = `<article class="prose"><header class="daf-head"><h1>The daf by email</h1></header>
<p>A daily email is on its way. It is not open for sign-ups yet; the <a href="/feed.xml">RSS feed</a> carries the same note each day in the meantime.</p></article>`;
  return page({ env, origin, title: "The daf by email", description: "The daily email is not open yet.", canonicalPath: "/newsletter", body, noLangSwitch: true });
}

/** A short parchment notice with one heading and a few paragraphs (already HTML). */
export function renderNotice(env: Env, origin: string, title: string, paragraphsHtml: string[], canonicalPath = "/newsletter"): string {
  const body = `<article class="prose"><header class="daf-head"><h1>${esc(title)}</h1></header>\n${paragraphsHtml.map((p) => `<p>${p}</p>`).join("\n")}</article>`;
  return page({ env, origin, title, description: title, canonicalPath, body, noLangSwitch: true });
}

export function renderCheckInbox(env: Env, origin: string): string {
  return renderNotice(env, origin, "One more step", [
    "If that address can receive mail, a confirmation is on its way. Click the button in it and the daf starts arriving at the hour you chose.",
    "If nothing arrives in a few minutes, check the spam folder; new senders often land there.",
    `<a href="/">Today's daf</a> is here if you would rather not wait.`,
  ]);
}

export function renderConfirmedPage(env: Env, origin: string, sub: SubscriberRow): string {
  const when = sub.edition === "tomorrow" ? `${hourLabel(sub.hour)} in ${esc(sub.tz ?? "")}, the evening before, with tomorrow's daf` : `${hourLabel(sub.hour)} in ${esc(sub.tz ?? "")}, with the day's daf`;
  return renderNotice(env, origin, "Done", [
    `The first issue arrives at ${when}.`,
    `Every issue has an unsubscribe link at the bottom that works in one click, and a link to <a href="/newsletter/prefs/${esc(sub.unsub_token)}">change the hour or time zone</a>.`,
    "If a note is off, reply to any issue; replies reach me.",
    `<a href="/">Today's daf</a> is here if you would rather not wait.`,
  ]);
}

export function renderExpired(env: Env, origin: string): string {
  return renderNotice(env, origin, "This link has expired", [
    "Confirmation links work once and for 48 hours.",
    `<a href="/newsletter">Ask again</a> and use the new one.`,
  ]);
}

export function renderUnsubPage(env: Env, origin: string, token: string, sub: SubscriberRow | null): string {
  const who = sub && sub.status !== "unsubscribed" ? ` to ${esc(sub.email)}` : "";
  const body = `<article class="prose"><header class="daf-head"><h1>Stop the daf${who}?</h1></header>
<form method="post" action="/newsletter/u/${esc(token)}"><button type="submit" class="btn">Yes, stop it</button></form>
<p class="muted small">Nothing else happens on this page. If a link scanner brought you here by accident, close it and nothing changes.</p></article>`;
  return page({ env, origin, title: "Unsubscribe", description: "Stop the daily email.", canonicalPath: "/newsletter", body, noLangSwitch: true });
}

export function renderGoodbye(env: Env, origin: string, sub: SubscriberRow | null): string {
  const who = sub && sub.status !== "unsubscribed" ? ` to ${esc(sub.email)}` : "";
  return renderNotice(env, origin, "Done", [
    `No more email from me${who}. I have deleted the address and the time zone that went with it.`,
    `If you ever want it back, <a href="/newsletter">the form is here</a>. Thank you for reading.`,
  ]);
}

export function hourLabel(h: number): string {
  if (h === 0) return "midnight";
  if (h === 12) return "noon";
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

export function renderPrefsPage(env: Env, origin: string, sub: SubscriberRow, tzOptions: string[], o: { saved?: boolean; error?: string } = {}): string {
  const hours = Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === sub.hour ? " selected" : ""}>${hourLabel(h)}</option>`).join("");
  const body = `
<article class="prose subscribe">
  <header class="daf-head"><h1>Your daf by email</h1></header>
  <p>${esc(sub.email)}. Change anything below, or stop the email altogether.</p>
  <form method="post" action="/newsletter/prefs/${esc(sub.unsub_token)}" class="subscribe-form">
    ${o.saved ? `<p class="muted" role="status">Saved.</p>` : ""}
    ${o.error ? `<p class="form-error" role="alert">${esc(o.error)}</p>` : ""}
    <fieldset>
      <legend>Which daf</legend>
      <label><input type="radio" name="edition" value="today"${sub.edition === "today" ? " checked" : ""}> The day's daf</label>
      <label><input type="radio" name="edition" value="tomorrow"${sub.edition === "tomorrow" ? " checked" : ""}> Tomorrow's daf, the evening before</label>
    </fieldset>
    <label>At what hour <select name="hour">${hours}</select></label>
    <label>Your time zone ${tzSelect(tzOptions, sub.tz ?? "UTC", true)}</label>
    <label class="check"><input type="checkbox" name="hold" value="1"${sub.hold_shabbat ? " checked" : ""}> Hold Shabbat and Yom Tov issues until after; the next issue lists what was held.</label>
    <button type="submit" class="btn">Save</button>
  </form>
  <form method="post" action="/newsletter/u/${esc(sub.unsub_token)}"><button type="submit" class="btn quiet">Stop the email</button></form>
</article>`;
  return page({ env, origin, title: "Your daf by email", description: "Change the hour, the time zone, or stop.", canonicalPath: "/newsletter", body, noLangSwitch: true });
}

export function renderPrivacyPage(env: Env, origin: string): string {
  const body = `
<article class="prose">
  <header class="daf-head"><h1>What I keep, and why</h1></header>
  <p>The site itself keeps nothing about you: no accounts, no tracking cookies, no analytics.</p>
  <p>If you subscribe to the daily email, I keep your address, your time zone, the hour and edition you chose, whether you asked to hold Shabbat and Yom Tov issues, the version of the sign-up text you agreed to, and the dates you confirmed and, if you leave, unsubscribed. I also keep a log of which issue went to which subscriber for sixty days, so the same issue is never sent twice. Nothing else: no opens, no clicks, no tracking pixel. I never store your IP address; the sign-up form uses it for ten minutes to limit repeat attempts and to run the bot check, keyed by a one-way hash, and then it is gone.</p>
  <p>Two companies touch it: the email provider that carries the mail (Resend, in the United States), and Cloudflare, which hosts the site and its database, also in the United States.</p>
  <p>When you unsubscribe, I delete your address and time zone right away. If an address bounces, or a reader reports an issue as spam, I keep a one-way hash of the address so it is never added again by mistake.</p>
  <p>You can stop at any time from the link at the bottom of every issue, change your settings from the same place, or write to me to see or erase whatever I hold. The legal basis for all of this is your consent, which you gave by confirming your address.</p>
  <p>Questions: <a href="mailto:joe@group17a.com">joe@group17a.com</a>.</p>
</article>`;
  return page({ env, origin, title: "Privacy", description: "What the daily email keeps about you, and why.", canonicalPath: "/newsletter/privacy", body, noLangSwitch: true });
}
