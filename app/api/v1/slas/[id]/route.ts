import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { slaPatchSchema } from "@/lib/api-sla-input";
import { slaReferences } from "@/lib/sla-references";
import { slaInUseRefusal } from "@/lib/sla-rules";
import { agentGuard, readBody } from "../../_itsm";
import { managerOnly } from "../../_manage";
import { SLA_SELECT, SLA_WHAT, prepareSla, slaNotFound, slaResponse, slaWriteConflict, updateSlaRecord } from "../../_slas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** One SLA with its calendar. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "sla:read");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  return slaResponse(id);
}

/** Update an SLA (MANAGER+). Only the fields sent change; `null` clears description, priority, calendar, escalation policy and import_ref. `meta.changed` lists what changed. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "sla:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, SLA_WHAT);
  if (refused) return refused;
  const { id } = await ctx.params;
  const current = await db.sLA.findUnique({ where: { id }, select: SLA_SELECT });
  if (!current) return slaNotFound();
  const body = await readBody(req, slaPatchSchema);
  if ("response" in body) return body.response;
  const prepared = await prepareSla(body.data, current);
  if ("response" in prepared) return prepared.response;
  try {
    const { changed } = await updateSlaRecord(current, prepared.data, auth.principal.userId, "API");
    return slaResponse(id, { meta: { changed } });
  } catch (err) {
    return slaWriteConflict(err);
  }
}

/**
 * Delete an SLA (MANAGER+). Refused with 409 while tickets or services still point at it:
 * `details.references` counts them by kind and `details.hint` says what to do (deactivate it with
 * `is_active: false` to retire it).
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "sla:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, SLA_WHAT);
  if (refused) return refused;
  const { id } = await ctx.params;
  const sla = await db.sLA.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!sla) return slaNotFound();
  const inUse = slaInUseRefusal(await slaReferences(id));
  if (inUse) {
    const { message, ...details } = inUse;
    return apiError(409, message, details);
  }
  // deleteMany: a concurrent delete of the same SLA is not an error, and only a real deletion is audited.
  const res = await db.sLA.deleteMany({ where: { id } });
  if (res.count > 0) {
    await writeAudit({ userId: auth.principal.userId, action: "DELETE", entity: "SLA", entityId: id, summary: `Deleted SLA "${sla.name}" via API` });
    revalidatePath("/settings/sla");
  }
  return ok({ id, deleted: res.count > 0 });
}
