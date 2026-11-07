import { db } from "@/lib/db";
import { ok, preflight } from "@/lib/api";
import { agentGuard } from "../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Groups with their member ids, to resolve a `group_id` and pick an assignee who is a member. */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "read");
  if ("response" in auth) return auth.response;
  const rows = await db.group.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true, type: true, email: true, members: { select: { userId: true, role: true } } },
  });
  return ok(
    rows.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      type: g.type,
      email: g.email,
      members: g.members.map((m) => ({ user_id: m.userId, role: m.role })),
    })),
  );
}
