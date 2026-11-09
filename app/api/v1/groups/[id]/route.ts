import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { agentGuard } from "../../_itsm";
import { GROUP_DETAIL_SELECT, serializeGroupDetail } from "../../_groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** One group with its members (user id, name, email, active, role). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "directory:read");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const group = await db.group.findUnique({ where: { id }, select: GROUP_DETAIL_SELECT });
  if (!group) return apiError(404, "Group not found");
  return ok(serializeGroupDetail(group));
}
