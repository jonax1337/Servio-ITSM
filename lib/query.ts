/** Helpers for URL-search-param driven lists (server components). */

export type SearchParams = { [k: string]: string | string[] | undefined };

export function getParam(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export function getPage(sp: SearchParams, key = "page"): number {
  const n = parseInt(getParam(sp, key) ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export const PAGE_SIZE = 15;

export type SortDir = "asc" | "desc";

/**
 * A list's effective `?sort=&dir=`: the URL's sort when the page offers that key (descending
 * unless `dir=asc`), otherwise the page's default sort in its own direction.
 */
export function listSort<K extends string>(
  sp: SearchParams,
  keys: readonly K[],
  fallback: { sort: K; dir: SortDir },
): { sort: K; dir: SortDir } {
  const requested = getParam(sp, "sort");
  const known = keys.find((k) => k === requested);
  if (!known) return fallback;
  return { sort: known, dir: getParam(sp, "dir") === "asc" ? "asc" : "desc" };
}

export function buildHref(
  pathname: string,
  current: SearchParams,
  patch: Record<string, string | number | undefined | null>,
) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v == null) continue;
    params.set(k, Array.isArray(v) ? v[0] ?? "" : v);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "" || v === "all") params.delete(k);
    else params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
