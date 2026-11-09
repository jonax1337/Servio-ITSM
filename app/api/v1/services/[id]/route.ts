import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { servicePatchSchema } from "@/lib/api-service-input";
import { SERVICE_ERROR_CODES, serviceReferences } from "@/lib/service-records";
import { inUseRefusal } from "@/lib/service-access";
import { agentGuard, readBody } from "../../_itsm";
import { managerRefusal, saveService, serviceDetail } from "../../_services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** A service with its supporting CIs (`assets`), `depends_on` and `used_by`. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "cmdb:read");
  if ("response" in auth) return auth.response;
  const detail = await serviceDetail((await ctx.params).id);
  if (!detail) return apiError(404, "Service not found");
  return ok(detail);
}

/** Update a service (MANAGER+). Only the fields sent change; `asset_ids` and `depends_on` replace their whole set. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "cmdb:write");
  if ("response" in auth) return auth.response;
  const refused = managerRefusal(auth.principal);
  if (refused) return refused;
  const { id } = await ctx.params;
  if (!(await db.service.findUnique({ where: { id }, select: { id: true } }))) return apiError(404, "Service not found");
  const body = await readBody(req, servicePatchSchema);
  if ("response" in body) return body.response;
  return saveService(auth.principal, body.data, { id, via: "via API" });
}

/**
 * Delete a service (MANAGER+). Refused with 409 while anything still points at
 * it (tickets, catalog items, dependent services, status incidents, change
 * templates, recurring tickets, freeze windows): set `status` to RETIRED
 * instead, which keeps the history intact. Its own CI links and dependencies
 * go with it.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "cmdb:write");
  if ("response" in auth) return auth.response;
  const refused = managerRefusal(auth.principal);
  if (refused) return refused;
  const { id } = await ctx.params;
  const service = await db.service.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!service) return apiError(404, "Service not found");
  const references = await serviceReferences(id);
  const inUse = inUseRefusal(references);
  if (inUse) {
    return apiError(409, inUse.message, { code: SERVICE_ERROR_CODES.inUse, references: inUse.references, suggestion: inUse.suggestion });
  }
  // The polymorphic Approval has no FK to Service (see deleteService in lib/actions/services.ts).
  await db.approval.deleteMany({ where: { entityType: "SERVICE", entityId: id } });
  await db.service.delete({ where: { id } });
  await writeAudit({ userId: auth.principal.userId, action: "DELETE", entity: "Service", entityId: id, summary: `Deleted service "${service.name}" via API` });
  return ok({ id, deleted: true });
}
