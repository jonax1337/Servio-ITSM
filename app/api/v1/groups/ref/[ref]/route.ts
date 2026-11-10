import { db } from "@/lib/db";
import { apiError, preflight, type ApiPrincipal } from "@/lib/api";
import { groupUpsertSchema, type GroupUpsert } from "@/lib/api-group-input";
import { agentGuard, readBody } from "../../../_itsm";
import { invalidRef, isUniqueOn, managerOnly, refOf } from "../../../_manage";
import {
  GROUP_SCALAR_SELECT, GROUP_WHAT, createGroupRecord, groupNotFound, groupResponse, groupWriteConflict, prepareGroup, updateGroupRecord,
} from "../../../_groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** The group with this origin reference (e.g. `directory:it-support`), or 404. */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "directory:read");
  if ("response" in auth) return auth.response;
  const ref = await refOf(ctx);
  const row = ref ? await db.group.findUnique({ where: { importRef: ref }, select: { id: true } }) : null;
  if (!row) return groupNotFound();
  return groupResponse(row.id);
}

/**
 * Upsert by origin reference (MANAGER+), for keeping the groups in step with a source. Creates the group
 * (201; `name` required) when the reference is new, otherwise writes only the fields sent (200). Re-sending
 * the same facts writes nothing and no audit row; `meta.changed` lists what changed. A name another group
 * already has is a 409 with that group's `id` (adopt it by setting its `import_ref` with PATCH). Members
 * are not touched: manage them through `/groups/{id}/members`.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "directory:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, GROUP_WHAT);
  if (refused) return refused;
  const ref = await refOf(ctx);
  if (!ref) return invalidRef();
  const body = await readBody(req, groupUpsertSchema);
  if ("response" in body) return body.response;

  try {
    return await upsert(auth.principal, ref, body.data);
  } catch (err) {
    // Two runs creating the same ref at once: the loser retries as an update.
    if (isUniqueOn(err, "importRef")) return upsert(auth.principal, ref, body.data).catch(groupWriteConflict);
    return groupWriteConflict(err);
  }
}

async function upsert(principal: ApiPrincipal, ref: string, b: GroupUpsert) {
  const current = await db.group.findUnique({ where: { importRef: ref }, select: GROUP_SCALAR_SELECT });
  if (!current && !b.name) return apiError(422, "Validation failed", { name: ["Required to create a new group"] });
  const prepared = await prepareGroup(b, current);
  if ("response" in prepared) return prepared.response;
  const via = `API (${ref})`;
  if (!current) {
    const id = await createGroupRecord({ ...prepared.data, name: b.name!, importRef: ref }, principal.userId, via);
    return groupResponse(id, { status: 201, meta: { created: true, changed: Object.keys(b) } });
  }
  const { id, changed } = await updateGroupRecord(current, prepared.data, principal.userId, via);
  return groupResponse(id, { meta: { created: false, changed } });
}
