import { tractateBySlug, type Tractate } from "./daf/tractates";
import { isLang, type Lang } from "./i18n/strings";

/** Page routes carry the language they were asked for; `lang` is absent for English so existing equality tests hold. */
export type Route =
  | { kind: "today"; lang?: Lang }
  | { kind: "daf"; tractate: Tractate; daf: number; lang?: Lang }
  | { kind: "tractate"; tractate: Tractate; lang?: Lang }
  | { kind: "tractates"; lang?: Lang }
  | { kind: "about"; lang?: Lang }
  | { kind: "feed"; lang?: Lang }
  | { kind: "lang"; lang: Lang }
  | { kind: "admin-translate"; action: "run" | "put" | "note" }
  | { kind: "admin-note-put" }
  | { kind: "api-today" }
  | { kind: "api-daf"; tractate: Tractate; daf: number }
  | { kind: "date"; ymd: string; lang?: Lang }
  | { kind: "relative"; offset: number; lang?: Lang }
  | { kind: "robots" }
  | { kind: "sitemap" }
  | { kind: "admin-bake" }
  | { kind: "og-card"; tractate: Tractate; daf: number; token: string }
  | { kind: "admin-og"; action: "bake" | "status" }
  | { kind: "newsletter" }
  | { kind: "newsletter-confirm" }
  | { kind: "newsletter-privacy" }
  | { kind: "newsletter-unsub"; token: string }
  | { kind: "newsletter-prefs"; token: string }
  | { kind: "newsletter-issue"; ymd: string }
  | { kind: "newsletter-hook-resend" }
  | { kind: "admin-newsletter"; action: AdminNewsletterAction }
  | { kind: "redirect"; to: string }
  | { kind: "not-found"; lang?: Lang };

export type AdminNewsletterAction = "status" | "send" | "tick" | "rebuild-edition" | "subscribe";
export type NewsletterRoute = Extract<Route, { kind: `newsletter${string}` | "admin-newsletter" }>;

/** Route kinds that exist under a language prefix. Everything else (api, admin, newsletter, robots, sitemap, lang) is English-only. */
const PREFIXABLE = new Set<Route["kind"]>(["today", "daf", "tractate", "tractates", "about", "feed", "relative", "date", "not-found"]);

export function parseRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "").toLowerCase() || "/" : pathname;
  if (path !== pathname) return { kind: "redirect", to: path };
  // A language prefix ("/he", "/he/bekhorot/2") wraps the page routes. It is stripped here, the rest is parsed as
  // usual, and redirects get the prefix back. No tractate slug is two letters, so nothing collides.
  const lm = /^\/([a-z]{2})(\/.*)?$/.exec(path);
  if (lm && lm[1] !== "en" && isLang(lm[1]!)) {
    const lang = lm[1] as Lang;
    const rest = lm[2] || "/";
    if (rest === "/today") return { kind: "redirect", to: `/${lang}` };
    if (rest === "/newsletter") return { kind: "redirect", to: "/newsletter" };
    const r = parsePage(rest);
    if (r.kind === "redirect") return { kind: "redirect", to: `/${lang}${r.to}` };
    if (!PREFIXABLE.has(r.kind)) return { kind: "not-found", lang };
    return { ...r, lang } as Route;
  }
  const sw = /^\/lang\/([a-z]{2})$/.exec(path);
  if (sw) return isLang(sw[1]!) ? { kind: "lang", lang: sw[1] as Lang } : { kind: "not-found" };
  if (path === "/admin/translate") return { kind: "admin-translate", action: "run" };
  if (path === "/admin/translate/put") return { kind: "admin-translate", action: "put" };
  if (path === "/admin/note") return { kind: "admin-translate", action: "note" };
  if (path === "/admin/note/put") return { kind: "admin-note-put" };
  if (path === "/admin/og/bake") return { kind: "admin-og", action: "bake" };
  if (path === "/admin/og/status") return { kind: "admin-og", action: "status" };
  return parsePage(path);
}

function parsePage(path: string): Route {
  if (path === "/") return { kind: "today" };
  if (path === "/today") return { kind: "redirect", to: "/" };
  if (path === "/yesterday") return { kind: "relative", offset: -1 };
  if (path === "/tomorrow") return { kind: "relative", offset: 1 };
  if (path === "/about") return { kind: "about" };
  if (path === "/tractates") return { kind: "tractates" };
  if (path === "/feed.xml" || path === "/feed" || path === "/rss.xml") return { kind: "feed" };
  if (path === "/robots.txt") return { kind: "robots" };
  if (path === "/sitemap.xml") return { kind: "sitemap" };
  if (path === "/api/today.json") return { kind: "api-today" };
  if (path === "/admin/bake") return { kind: "admin-bake" };
  let m = /^\/api\/([a-z-]+)\/(\d{1,3})\.json$/.exec(path);
  if (m) {
    const t = tractateBySlug(m[1]!);
    const daf = Number(m[2]);
    return t && daf >= t.firstDaf && daf <= t.lastDaf ? { kind: "api-daf", tractate: t, daf } : { kind: "not-found" };
  }
  m = /^\/date\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if (m) return { kind: "date", ymd: m[1]! };
  // The share card behind a shared link: /og/<slug>/<daf>/<token>.png (src/og). English only; the token is the
  // card's version, so a redrawn card is a new URL for every crawler cache.
  m = /^\/og\/([a-z-]+)\/(\d{1,3})\/([0-9a-f]{8})\.png$/.exec(path);
  if (m) {
    const t = tractateBySlug(m[1]!);
    const daf = Number(m[2]);
    return t && daf >= t.firstDaf && daf <= t.lastDaf ? { kind: "og-card", tractate: t, daf, token: m[3]! } : { kind: "not-found" };
  }
  // Newsletter routes sit before the tractate patterns, which would otherwise swallow "/newsletter".
  // Reader tokens are 48 lowercase hex characters because paths are lower-cased above; the confirmation
  // token travels in the query string for the same reason.
  if (path === "/newsletter") return { kind: "newsletter" };
  if (path === "/newsletter/confirm") return { kind: "newsletter-confirm" };
  if (path === "/newsletter/privacy") return { kind: "newsletter-privacy" };
  if (path === "/newsletter/hooks/resend") return { kind: "newsletter-hook-resend" };
  m = /^\/newsletter\/u\/([0-9a-f]{48})$/.exec(path);
  if (m) return { kind: "newsletter-unsub", token: m[1]! };
  m = /^\/newsletter\/prefs\/([0-9a-f]{48})$/.exec(path);
  if (m) return { kind: "newsletter-prefs", token: m[1]! };
  m = /^\/newsletter\/issue\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if (m) return { kind: "newsletter-issue", ymd: m[1]! };
  m = /^\/admin\/newsletter\/(status|send|tick|rebuild-edition|subscribe)$/.exec(path);
  if (m) return { kind: "admin-newsletter", action: m[1] as AdminNewsletterAction };
  m = /^\/([a-z-]+)$/.exec(path);
  if (m) {
    const t = tractateBySlug(m[1]!);
    return t ? { kind: "tractate", tractate: t } : { kind: "not-found" };
  }
  m = /^\/([a-z-]+)\/(\d{1,3})([ab])?$/.exec(path);
  if (m) {
    const t = tractateBySlug(m[1]!);
    if (!t) return { kind: "not-found" };
    const daf = Number(m[2]);
    if (daf < t.firstDaf || daf > t.lastDaf) return { kind: "not-found" };
    if (m[3]) return { kind: "redirect", to: `/${t.slug}/${daf}#${m[3]}` };
    return { kind: "daf", tractate: t, daf };
  }
  return { kind: "not-found" };
}
