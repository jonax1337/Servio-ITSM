/**
 * Map an OIDC identity's groups/roles claim to a Servio role (#48).
 *
 * Pure and DB-free so it can be unit-tested; the sign-in wiring lives in
 * `auth.ts` (jwt callback), which persists the result on the user row.
 *
 * Configuration (all optional — without AUTH_OIDC_ROLE_MAP nothing changes and
 * SSO users keep whatever role an admin gave them):
 *
 *   AUTH_OIDC_ROLE_MAP     "it-admins=ADMIN,service-desk=AGENT,team-leads=MANAGER"
 *   AUTH_OIDC_ROLES_CLAIM  claim to read, dot path allowed (default "groups",
 *                          e.g. "roles" or "realm_access.roles" for Keycloak)
 *   AUTH_OIDC_DEFAULT_ROLE role when the claim is present but nothing matches
 *                          (default USER)
 *   AUTH_OIDC_ROLE_SYNC    "login" (default): re-evaluate on every SSO sign-in, so
 *                          the IdP is the source of truth; "signup": only on the
 *                          account's first sign-in, admins manage it afterwards.
 */

export const SERVIO_ROLES = ["USER", "AGENT", "MANAGER", "ADMIN"] as const;
export type ServioRole = (typeof SERVIO_ROLES)[number];

const RANK: Record<ServioRole, number> = { USER: 0, AGENT: 1, MANAGER: 2, ADMIN: 3 };

export type OidcRoleConfig = {
  claim: string;
  map: Map<string, ServioRole>;
  defaultRole: ServioRole;
  sync: "login" | "signup";
};

function asRole(value: string | undefined): ServioRole | null {
  const v = value?.trim().toUpperCase();
  return v && (SERVIO_ROLES as readonly string[]).includes(v) ? (v as ServioRole) : null;
}

/** Keycloak's group mapper emits full paths ("/it/admins") unless told not to; compare without the leading slash. */
function normalizeGroup(value: string): string {
  return value.trim().replace(/^\/+/, "").toLowerCase();
}

/**
 * Parse AUTH_OIDC_ROLE_MAP. Entries are `group=ROLE`, separated by commas or
 * newlines; the last `=` splits, so group names may contain `=`. Throws on an
 * unknown role so a typo fails loudly at startup instead of silently demoting.
 */
export function parseRoleMap(raw: string | undefined): Map<string, ServioRole> {
  const map = new Map<string, ServioRole>();
  for (const entry of (raw ?? "").split(/[,\n]/)) {
    if (!entry.trim()) continue;
    const at = entry.lastIndexOf("=");
    if (at <= 0) throw new Error(`AUTH_OIDC_ROLE_MAP: "${entry.trim()}" is not group=ROLE`);
    const group = normalizeGroup(entry.slice(0, at));
    const role = asRole(entry.slice(at + 1));
    if (!group || !role) throw new Error(`AUTH_OIDC_ROLE_MAP: "${entry.trim()}" needs one of ${SERVIO_ROLES.join(", ")}`);
    const prev = map.get(group);
    if (!prev || RANK[role] > RANK[prev]) map.set(group, role);
  }
  return map;
}

/** The role-mapping config from the environment, or null when mapping is off. */
export function oidcRoleConfig(env: Record<string, string | undefined> = process.env): OidcRoleConfig | null {
  const map = parseRoleMap(env.AUTH_OIDC_ROLE_MAP);
  if (map.size === 0) return null;
  const rawDefault = env.AUTH_OIDC_DEFAULT_ROLE;
  const defaultRole = rawDefault?.trim() ? asRole(rawDefault) : "USER";
  if (!defaultRole) throw new Error(`AUTH_OIDC_DEFAULT_ROLE must be one of ${SERVIO_ROLES.join(", ")}`);
  const sync = (env.AUTH_OIDC_ROLE_SYNC ?? "login").trim().toLowerCase();
  if (sync !== "login" && sync !== "signup") throw new Error('AUTH_OIDC_ROLE_SYNC must be "login" or "signup"');
  return { claim: env.AUTH_OIDC_ROLES_CLAIM?.trim() || "groups", map, defaultRole, sync };
}

/**
 * The claim's values as strings, or null when the claim is absent. Absent and
 * empty are deliberately different: a missing claim usually means the IdP mapper
 * is not configured, and must not demote everyone on their next sign-in.
 */
export function claimValues(profile: Record<string, unknown> | undefined, path: string): string[] | null {
  let node: unknown = profile;
  for (const key of path.split(".")) {
    if (node === null || typeof node !== "object" || !(key in (node as object))) return null;
    node = (node as Record<string, unknown>)[key];
  }
  if (node === null || node === undefined) return null;
  const list = Array.isArray(node) ? node : typeof node === "string" ? node.split(/[,\s]+/) : [node];
  return list.filter((v): v is string | number => typeof v === "string" || typeof v === "number").map(String).filter(Boolean);
}

/**
 * The role an identity should have: the highest role any of its groups maps to,
 * the default role when the claim is present but nothing matches, and null
 * (= leave the role alone) when the claim is missing.
 */
export function resolveOidcRole(profile: Record<string, unknown> | undefined, config: OidcRoleConfig): ServioRole | null {
  const values = claimValues(profile, config.claim);
  if (values === null) return null;
  let best: ServioRole | null = null;
  for (const value of values) {
    const role = config.map.get(normalizeGroup(value));
    if (role && (!best || RANK[role] > RANK[best])) best = role;
  }
  return best ?? config.defaultRole;
}

/** Whether this sign-in should (re)apply the mapped role. */
export function shouldSyncRole(config: OidcRoleConfig, isNewUser: boolean): boolean {
  return config.sync === "login" || isNewUser;
}
