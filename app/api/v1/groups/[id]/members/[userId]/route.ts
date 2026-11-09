import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { agentGuard } from "../../../../_itsm";
import { managerOnly } from "../../../../_manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Remove a user from a group (MANAGER+). Idempotent: a user who is not a member answers 200 with `removed` false. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; userId: string }> }) {
  const auth = await agentGuard(req, "directory:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, "group members");
  if (refused) return refused;
  const { id, userId } = await ctx.params;
  const group = await db.group.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!group) return apiError(404, "Group not found");

  const member = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId } },
    select: { id: true, user: { select: { name: true, email: true } } },
  });
  if (!member) return ok({ group_id: id, user_id: userId, removed: false });
  // deleteMany: a concurrent removal of the same membership is not an error.
  const res = await db.groupMember.deleteMany({ where: { id: member.id } });
  if (res.count > 0) {
    await writeAudit({
      userId: auth.principal.userId, action: "UPDATE", entity: "Group", entityId: id,
      summary: `Removed ${member.user.name ?? member.user.email} from "${group.name}" via API`,
    });
  }
  return ok({ group_id: id, user_id: userId, removed: res.count > 0 });
}
