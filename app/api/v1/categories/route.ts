import { db } from "@/lib/db";
import { ok, preflight } from "@/lib/api";
import { agentGuard } from "../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Categories (shared by tickets, problems and changes), to resolve a `category_id`. `include_archived=true` adds archived ones. */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "read");
  if ("response" in auth) return auth.response;
  const includeArchived = new URL(req.url).searchParams.get("include_archived") === "true";
  const rows = await db.category.findMany({
    where: includeArchived ? {} : { archived: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true, parentId: true, groupId: true, archived: true },
  });
  return ok(rows.map((c) => ({ id: c.id, name: c.name, description: c.description, parent_id: c.parentId, group_id: c.groupId, archived: c.archived })));
}
