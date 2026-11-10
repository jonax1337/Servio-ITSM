import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { groupPatchSchema } from "@/lib/api-group-input";
import { groupReferences } from "@/lib/group-references";
import { groupInUseRefusal } from "@/lib/group-rules";
import { agentGuard, readBody } from "../../_itsm";
import { managerOnly } from "../../_manage";
import {
  GROUP_SCALAR_SELECT, GROUP_WHAT, groupNotFound, groupResponse, groupWriteConflict, prepareGroup, updateGroupRecord,
} from "../../_groups";

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
  return groupResponse(id);
}

/** Update a group (MANAGER+). Only the fields sent change; `null` clears description, email, manager and import_ref. `meta.changed` lists what changed. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "directory:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, GROUP_WHAT);
  if (refused) return refused;
  const { id } = await ctx.params;
  const current = await db.group.findUnique({ where: { id }, select: GROUP_SCALAR_SELECT });
  if (!current) return groupNotFound();
  const body = await readBody(req, groupPatchSchema);
  if ("response" in body) return body.response;
  const prepared = await prepareGroup(body.data, current);
  if ("response" in prepared) return prepared.response;
  try {
    const { changed } = await updateGroupRecord(current, prepared.data, auth.principal.userId, "API");
    return groupResponse(id, { meta: { changed } });
  } catch (err) {
    return groupWriteConflict(err);
  }
}

/**
 * Delete a group (MANAGER+). Refused with 409 while anything still points at it (categories, services,
 * catalog items and their visibility, open tickets, problems and changes, schedules, automations, ...):
 * `details.references` counts them by kind and `details.hint` says what to do. Its memberships go with it.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "directory:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, GROUP_WHAT);
  if (refused) return refused;
  const { id } = await ctx.params;
  const group = await db.group.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!group) return groupNotFound();
  const inUse = groupInUseRefusal(await groupReferences(id));
  if (inUse) {
    const { message, ...details } = inUse;
    return apiError(409, message, details);
  }
  // deleteMany: a concurrent delete of the same group is not an error, and only a real deletion is audited.
  const res = await db.group.deleteMany({ where: { id } });
  if (res.count > 0) {
    await writeAudit({ userId: auth.principal.userId, action: "DELETE", entity: "Group", entityId: id, summary: `Deleted group "${group.name}" via API` });
    revalidatePath("/groups");
  }
  return ok({ id, deleted: res.count > 0 });
}
