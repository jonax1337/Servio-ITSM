import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { checkApiRate } from "@/lib/rate-limit";
import { parseStoredScopes, scopeGrants, type ResourceScope } from "@/lib/api-scopes";

// A pre-computed bcrypt hash of a fixed dummy string. When no token matches the
// presented prefix we still run one bcrypt.compare against this so the failure
// path costs roughly the same as a real single-candidate verify — this keeps
// timing constant and avoids leaking "prefix exists" via response latency.
const DUMMY_HASH = "$2b$10$sxF5LralJ4wtjwA8f2Vi5OEU6oR8u52rCQmM0SLzreIDJadPuJf6m";

export type ApiPrincipal = {
  tokenId: string;
  userId: string;
  scopes: string[];
  /** Acting user's role — used to scope object access (agents see all). */
  role: string;
};

/** Agents (AGENT/MANAGER/ADMIN) may act org-wide; USERs are scoped to their own objects. */
const AGENT_RANK: Record<string, number> = { USER: 0, AGENT: 1, MANAGER: 2, ADMIN: 3 };
export function principalIsAgent(principal: ApiPrincipal) {
  return (AGENT_RANK[principal.role] ?? 0) >= AGENT_RANK.AGENT;
}

/** Authenticate a request via `Authorization: Bearer <token>`. */
export async function authenticateApi(req: Request): Promise<ApiPrincipal | null> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const raw = match[1].trim();

  // Look up ONLY by exact prefix. A miss fails immediately — we never fall back
  // to scanning + bcrypt-comparing every active token (that turned any bad
  // token into an O(N) bcrypt DoS). To keep the timing of a prefix-miss close
  // to a prefix-hit, we still burn one bcrypt compare before returning.
  const pool = await db.apiToken.findMany({
    where: { revoked: false, prefix: raw.slice(0, 18) },
  });
  if (!pool.length) {
    await bcrypt.compare(raw, DUMMY_HASH);
    return null;
  }

  for (const t of pool) {
    if (t.expiresAt && t.expiresAt.getTime() < Date.now()) continue;
    if (await bcrypt.compare(raw, t.tokenHash)) {
      // Resolve the acting user; reject tokens whose owner is deactivated.
      const user = await db.user.findUnique({
        where: { id: t.userId },
        select: { isActive: true, role: true },
      });
      if (!user || !user.isActive) return null;
      await db.apiToken.update({
        where: { id: t.id },
        data: { lastUsedAt: new Date() },
      });
      return {
        tokenId: t.id,
        userId: t.userId,
        scopes: parseStoredScopes(t.scopes),
        role: user.role,
      };
    }
  }
  return null;
}

/** Whether the token may use an endpoint that needs `scope` (see lib/api-scopes.ts). */
export function hasScope(principal: ApiPrincipal, scope: ResourceScope) {
  return scopeGrants(principal.scopes, scope);
}

/**
 * Validate a ticket assignee before writing it. An assignee must be an existing,
 * active AGENT (or higher) and — when the ticket has a group — a member of that
 * group. Returns null when valid, or a human-readable reason otherwise. Callers
 * should surface a 422 rather than letting a bad FK bubble up as a 500.
 */
export async function validateTicketAssignee(
  assigneeId: string,
  groupId: string | null,
): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: assigneeId },
    select: { isActive: true, role: true },
  });
  if (!user) return "assigneeId does not reference an existing user.";
  if (!user.isActive) return "assigneeId references a deactivated user.";
  if ((AGENT_RANK[user.role] ?? 0) < AGENT_RANK.AGENT)
    return "assigneeId must reference an agent.";
  if (groupId) {
    const member = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: assigneeId } },
      select: { userId: true },
    });
    if (!member) return "assigneeId must be a member of the ticket's group.";
  }
  return null;
}

// Bearer-token APIs don't use cookies, so cross-origin browser access is not
// needed by default. CORS stays CLOSED unless API_CORS_ORIGIN is explicitly
// configured: no Access-Control-* headers are emitted, making the API
// same-origin-only. Set an exact origin to opt a browser client in.
function corsHeaders(): Record<string, string> {
  const origin = process.env.API_CORS_ORIGIN?.trim();
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

export function ok(data: unknown, init?: { status?: number; meta?: unknown }) {
  return NextResponse.json(
    init?.meta !== undefined ? { data, meta: init.meta } : { data },
    { status: init?.status ?? 200, headers: corsHeaders() },
  );
}

export function apiError(status: number, message: string, details?: unknown) {
  return NextResponse.json({ error: { message, details } }, { status, headers: corsHeaders() });
}

export function preflight() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/** Best-effort client IP from proxy headers (single-node deploy). */
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Standard auth guard used by every protected route. `scope` is the resource
 * scope the handler needs; the legacy `read`/`write`/`admin` scopes satisfy it
 * as described in lib/api-scopes.ts.
 */
export async function guard(
  req: Request,
  scope: ResourceScope,
): Promise<{ principal: ApiPrincipal } | { response: NextResponse }> {
  const auth = await authenticatedPrincipal(req);
  if ("response" in auth) return auth;
  if (!hasScope(auth.principal, scope)) {
    return { response: apiError(403, `This token lacks the '${scope}' scope.`, { required_scope: scope }) };
  }
  return auth;
}

/** The token's principal, whatever its scopes (rate limited like `guard`), or the 401/429 response. */
export async function authenticatedPrincipal(req: Request): Promise<{ principal: ApiPrincipal } | { response: NextResponse }> {
  // Throttle the Bearer entry point before doing any DB work. Key by the raw
  // token when present (so one noisy token can't exhaust the shared IP bucket),
  // else by client IP for unauthenticated/malformed requests.
  const authz = req.headers.get("authorization") ?? "";
  const tokenMatch = authz.match(/^Bearer\s+(.+)$/i);
  const rateKey = tokenMatch ? `t:${tokenMatch[1].trim().slice(0, 18)}` : `ip:${clientIp(req)}`;
  const limited = checkApiRate(rateKey);
  if (limited) {
    const retryAfter = Math.ceil(limited.retryAfterMs / 1000);
    return {
      response: NextResponse.json(
        { error: { message: "Rate limit exceeded. Slow down and retry later." } },
        { status: 429, headers: { ...corsHeaders(), "Retry-After": String(retryAfter) } },
      ),
    };
  }

  const principal = await authenticateApi(req);
  if (!principal) {
    return {
      response: apiError(401, "Missing or invalid API token. Send 'Authorization: Bearer <token>'."),
    };
  }
  return { principal };
}

export function paginate(searchParams: URLSearchParams) {
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get("per_page") ?? "25", 10) || 25));
  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

export function pageMeta(page: number, perPage: number, total: number) {
  return { page, per_page: perPage, total, total_pages: Math.max(1, Math.ceil(total / perPage)) };
}
