import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, preflight, paginate, pageMeta } from "@/lib/api";
import { anyEmailContains } from "@/lib/user-emails";
import { agentGuard } from "../_itsm";
import { USER_SELECT, serializeUser } from "../_users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * Users, minimal fields only (id, name, email, secondary_emails, role, active),
 * to resolve an `assignee_id` or `requesterId`. Filters: `q` (name, primary or
 * secondary email), `role`, `active` (default true; `all` for both).
 */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "directory:read");
  if ("response" in auth) return auth.response;
  const p = new URL(req.url).searchParams;
  const { page, perPage, skip, take } = paginate(p);

  const where: Prisma.UserWhereInput = {};
  const active = p.get("active") ?? "true";
  if (active !== "all") where.isActive = active !== "false";
  if (p.get("role")) where.role = p.get("role")!;
  const q = p.get("q")?.trim();
  if (q) where.OR = [{ name: { contains: q } }, ...anyEmailContains(q)];

  const [total, rows] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({ where, orderBy: { name: "asc" }, skip, take, select: USER_SELECT }),
  ]);
  return ok(rows.map(serializeUser), { meta: pageMeta(page, perPage, total) });
}
