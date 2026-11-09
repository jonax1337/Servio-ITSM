import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AUTOMATION_EMAIL } from "@/lib/system-user";
import { groupMemberAddSchema } from "@/lib/api-group-input";
import { agentGuard, readBody } from "../../../_itsm";
import { managerOnly } from "../../../_manage";
import { serializeMember } from "../../../_groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * Add a user to a group (MANAGER+, like the console). Idempotent: an existing
 * membership answers 200 (`meta.created` false) and is left unchanged, a new one 201.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "directory:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, "group members");
  if (refused) return refused;
  const { id } = await ctx.params;
  const group = await db.group.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!group) return apiError(404, "Group not found");
  const body = await readBody(req, groupMemberAddSchema);
  if ("response" in body) return body.response;

  const user = await db.user.findUnique({ where: { id: body.data.user_id }, select: { id: true, name: true, email: true, isActive: true } });
  if (!user || user.email === AUTOMATION_EMAIL) return apiError(422, "Validation failed", { user_id: ["Unknown user"] });

  const existing = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId: user.id } },
    select: { role: true },
  });
  if (existing) return ok(serializeMember({ role: existing.role, user }), { meta: { created: false } });

  try {
    await db.groupMember.create({ data: { groupId: id, userId: user.id, role: body.data.role ?? "MEMBER" } });
  } catch (err) {
    // A concurrent identical request won the race: same outcome as the existing-membership branch.
    if ((err as { code?: string })?.code !== "P2002") throw err;
    const current = await db.groupMember.findUniqueOrThrow({ where: { groupId_userId: { groupId: id, userId: user.id } }, select: { role: true } });
    return ok(serializeMember({ role: current.role, user }), { meta: { created: false } });
  }
  await writeAudit({
    userId: auth.principal.userId, action: "UPDATE", entity: "Group", entityId: id,
    summary: `Added ${user.name ?? user.email} to "${group.name}" via API`,
  });
  return ok(serializeMember({ role: body.data.role ?? "MEMBER", user }), { status: 201, meta: { created: true } });
}
