/**
 * API token scopes, DB-free so the rules can be unit-tested and shared by the
 * guard (lib/api.ts), the token form (lib/token-rules.ts) and the OpenAPI spec.
 *
 * Two kinds of scope exist side by side:
 * - The coarse legacy scopes `read`, `write` and `admin`. They keep exactly the
 *   rights they always had: `read` grants every resource read, `write` every
 *   resource write except the privileged ones, `admin` everything.
 * - Resource scopes `<resource>:read` / `<resource>:write` for least-privilege
 *   integrations. A resource write also grants that resource's read.
 *
 * Every /api/v1 handler declares the resource scope it needs (`guard(req, "tickets:write")`);
 * tests/unit/api-route-scopes.test.ts holds each handler to `requiredScope()` below.
 */

export const LEGACY_SCOPES = ["read", "write", "admin"] as const;
export type LegacyScope = (typeof LEGACY_SCOPES)[number];

/** Resource scopes in display order. A resource only has the accesses its endpoints need. */
export const RESOURCE_SCOPES = [
  "tickets:read",
  "tickets:write",
  "recurring:read",
  "recurring:write",
  "problems:read",
  "problems:write",
  "changes:read",
  "changes:write",
  "cmdb:read",
  "cmdb:write",
  "kb:read",
  "kb:write",
  "catalog:read",
  "catalog:write",
  "directory:read",
  "import:write",
] as const;
export type ResourceScope = (typeof RESOURCE_SCOPES)[number];
export type ApiScope = LegacyScope | ResourceScope;

export type ApiResource = ResourceScope extends `${infer R}:${string}` ? R : never;
export type ScopeAccess = "read" | "write";

/** Resources in display order (each once). */
export const API_RESOURCES = [...new Set(RESOURCE_SCOPES.map((s) => s.split(":")[0]))] as ApiResource[];

/**
 * Scopes the legacy `write` does not cover and only an ADMIN owner may hold:
 * writes that bypass the lifecycle (history import, publishing past the review).
 * Before resource scopes they needed `admin`, which still grants them.
 */
export const PRIVILEGED_SCOPES: readonly ResourceScope[] = ["import:write"];

/** Scopes a token may only carry when its owner is an ADMIN. */
export const ADMIN_ONLY_SCOPES: readonly ApiScope[] = ["admin", ...PRIVILEGED_SCOPES];

const ALL_SCOPES: readonly ApiScope[] = [...LEGACY_SCOPES, ...RESOURCE_SCOPES];

export function isApiScope(value: string): value is ApiScope {
  return (ALL_SCOPES as readonly string[]).includes(value);
}

/** The scopes a resource offers (e.g. `directory` only reads, `import` only writes). */
export function resourceScopes(resource: ApiResource): ResourceScope[] {
  return RESOURCE_SCOPES.filter((s) => s.startsWith(`${resource}:`));
}

/** Whether a token holding `held` may use an endpoint that needs `required`. */
export function scopeGrants(held: readonly string[], required: ResourceScope): boolean {
  if (held.includes(required) || held.includes("admin")) return true;
  const [resource, access] = required.split(":") as [ApiResource, ScopeAccess];
  if (access === "read") return held.includes("read") || held.includes(`${resource}:write`);
  return held.includes("write") && !PRIVILEGED_SCOPES.includes(required);
}

/** Legacy scopes and resource scopes another held scope already grants carry no extra right. */
function redundant(scope: ApiScope, held: readonly ApiScope[]): boolean {
  if (!(RESOURCE_SCOPES as readonly string[]).includes(scope)) return false;
  return scopeGrants(held.filter((h) => h !== scope), scope as ResourceScope);
}

/**
 * A scope selection as it is stored: known scopes only, each once, in catalog
 * order, without resource scopes another held scope already grants. Null when
 * the selection holds an unknown scope or nothing at all.
 */
export function normalizeScopes(values: readonly string[]): ApiScope[] | null {
  const picked = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (!picked.length || !picked.every(isApiScope)) return null;
  const ordered = ALL_SCOPES.filter((s) => picked.includes(s));
  return ordered.filter((s) => !redundant(s, ordered));
}

/** A token's stored scope string (comma-separated) as a list. */
export function parseStoredScopes(csv: string): string[] {
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * The first /api/v1 path segment of every route group and the resource it
 * belongs to. A new route group must be added here (the route test fails
 * until it is), which forces a deliberate scope decision.
 */
export const RESOURCE_BY_SEGMENT: Record<string, ApiResource> = {
  tickets: "tickets",
  "recurring-tickets": "recurring",
  problems: "problems",
  changes: "changes",
  assets: "cmdb",
  services: "cmdb",
  licenses: "cmdb",
  vendors: "cmdb",
  articles: "kb",
  categories: "catalog",
  groups: "directory",
  users: "directory",
  import: "import",
};

/** Paths that answer without a token. */
export const PUBLIC_API_PATHS: readonly string[] = ["/", "/openapi"];

const READ_METHODS = ["GET", "HEAD"];

/**
 * The scope an endpoint needs, from its path below /api/v1 (`/tickets/{id}` or
 * `/tickets/42`) and HTTP method: the route group's resource, `read` for
 * GET/HEAD and `write` otherwise. Null for public paths and preflights;
 * undefined when the path belongs to no known resource or the resource has
 * no such access — both mean a route was added without a scope decision.
 */
export function requiredScope(path: string, method: string): ResourceScope | null | undefined {
  const verb = method.toUpperCase();
  if (verb === "OPTIONS" || PUBLIC_API_PATHS.includes(path)) return null;
  const segment = path.split("/").filter(Boolean)[0] ?? "";
  const resource = Object.hasOwn(RESOURCE_BY_SEGMENT, segment) ? RESOURCE_BY_SEGMENT[segment] : undefined;
  if (!resource) return undefined;
  const scope = `${resource}:${READ_METHODS.includes(verb) ? "read" : "write"}`;
  return (RESOURCE_SCOPES as readonly string[]).includes(scope) ? (scope as ResourceScope) : undefined;
}

/** Every scope that satisfies `required`, most specific first (for the OpenAPI security requirements). */
export function scopesGranting(required: ResourceScope): ApiScope[] {
  return ([...RESOURCE_SCOPES, ...LEGACY_SCOPES] as ApiScope[]).filter((s) => scopeGrants([s], required));
}
