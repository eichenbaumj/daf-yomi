import { tractateBySlug, type Tractate } from "./daf/tractates";

export type Route =
  | { kind: "today" }
  | { kind: "daf"; tractate: Tractate; daf: number }
  | { kind: "tractate"; tractate: Tractate }
  | { kind: "tractates" }
  | { kind: "about" }
  | { kind: "feed" }
  | { kind: "api-today" }
  | { kind: "api-daf"; tractate: Tractate; daf: number }
  | { kind: "date"; ymd: string }
  | { kind: "relative"; offset: number }
  | { kind: "robots" }
  | { kind: "sitemap" }
  | { kind: "admin-bake" }
  | { kind: "redirect"; to: string }
  | { kind: "not-found" };

export function parseRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "").toLowerCase() || "/" : pathname;
  if (path !== pathname) return { kind: "redirect", to: path };
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
