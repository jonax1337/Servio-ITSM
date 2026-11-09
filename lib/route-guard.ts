/**
 * Edge-safe per-route permission map for the agent console.
 *
 * This module is imported by the middleware (`proxy.ts`), which runs on the
 * Edge runtime — so it MUST stay free of React / icon / Node imports. It only
 * deals in route prefixes and role ranks.
 *
 * The minRole values mirror those declared on the nav items in `lib/nav.ts`.
 * Anything not listed here is a plain console route that only requires AGENT.
 * (The two maps are intentionally kept in sync by hand for now — see the note
 * in proxy.ts / the follow-ups; a future refactor can derive one from the
 * other.)
 */

export type ConsoleRole = "AGENT" | "MANAGER" | "ADMIN";

const RANK = { USER: 0, AGENT: 1, MANAGER: 2, ADMIN: 3 } as const;

export type RankRole = keyof typeof RANK;

const PUBLIC_PREFIXES = ["/login", "/api/auth", "/api/v1", "/survey", "/brand", "/maintenance", "/api/maintenance"];

/**
 * Everything a plain USER may reach: the portal pages plus the APIs those pages
 * call. Each of these route handlers authorises the live DB user itself
 * (USER-scoped search/assistant, `canUploadTo` / `canViewAttachment` for files).
 */
const PORTAL_PREFIXES = ["/portal", "/api/portal", "/api/files"];

function matchesAnyPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Public route namespaces match whole path segments, including static brand assets. */
export function isPublicPath(path: string): boolean {
  return matchesAnyPrefix(path, PUBLIC_PREFIXES);
}

/** True for routes that belong to the self-service portal (see PORTAL_PREFIXES). */
export function isPortalPath(path: string): boolean {
  return matchesAnyPrefix(path, PORTAL_PREFIXES);
}

/** Rank of a role string (unknown roles fall back to the lowest rank). */
export function roleRank(role: string): number {
  return RANK[role as RankRole] ?? 0;
}

/** True when `role` is at least `min` in the ADMIN>MANAGER>AGENT>USER order. */
export function roleAtLeast(role: string, min: RankRole): boolean {
  return roleRank(role) >= RANK[min];
}

/**
 * Prefix → minimum role for console routes that need more than plain AGENT.
 * Longest prefix wins (see `requiredRoleFor`). Keep in sync with `lib/nav.ts`.
 */
export const ROUTE_MIN_ROLE: ReadonlyArray<{ prefix: string; minRole: ConsoleRole }> = [
  { prefix: "/catalog", minRole: "MANAGER" },
  { prefix: "/automations", minRole: "MANAGER" },
  { prefix: "/syncs", minRole: "MANAGER" },
  // Change freeze windows and standard-change templates are managed by
  // MANAGER+; agents see freezes on the calendar and pick templates on /changes/new.
  { prefix: "/changes/freeze", minRole: "MANAGER" },
  { prefix: "/changes/templates", minRole: "MANAGER" },
  // Longest prefix wins — agents may open /settings/macros for their personal
  // macros even though the rest of /settings needs MANAGER.
  { prefix: "/settings/macros", minRole: "AGENT" },
  // Self-update and maintenance windows are admin-only.
  { prefix: "/settings/updates", minRole: "ADMIN" },
  // Backups hold every record: admin-only, like updates.
  { prefix: "/settings/backups", minRole: "ADMIN" },
  { prefix: "/settings", minRole: "MANAGER" },
  { prefix: "/sla", minRole: "MANAGER" },
  { prefix: "/audit", minRole: "ADMIN" },
];

/**
 * The minimum role required to open `path` in the console.
 * Every authenticated console route requires at least AGENT; the map above
 * escalates specific areas to MANAGER (or higher). Returns the strictest match
 * when several prefixes apply.
 */
export function requiredRoleFor(path: string): ConsoleRole {
  let required: ConsoleRole = "AGENT";
  let bestLen = 0;
  for (const { prefix, minRole } of ROUTE_MIN_ROLE) {
    const matches = path === prefix || path.startsWith(`${prefix}/`);
    if (matches && prefix.length > bestLen) {
      required = minRole;
      bestLen = prefix.length;
    }
  }
  return required;
}
