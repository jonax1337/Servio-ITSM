import { db } from "@/lib/db";
import { ok, apiError, preflight } from "@/lib/api";
import { unassignLicense } from "@/lib/actions/contracts";
import { formOf } from "@/lib/api-itsm-input";
import { LICENSE_INCLUDE, serializeLicense } from "../../../../_serializers";
import { agentGuard, asActor, refusal } from "../../../../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Release one seat (MANAGER or above). The assignment must belong to this license, else 404. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; assignmentId: string }> }) {
  const auth = await agentGuard(req, "cmdb:write");
  if ("response" in auth) return auth.response;
  const { id, assignmentId } = await ctx.params;
  const row = await db.licenseAssignment.findUnique({ where: { id: assignmentId }, select: { licenseId: true } });
  if (!row || row.licenseId !== id) return apiError(404, "Assignment not found");
  const result = await asActor(auth.principal, () => unassignLicense(formOf({ assignmentId })));
  if (!result.ok) return refusal(result.error ?? "The request was refused.");
  return ok(serializeLicense(await db.softwareLicense.findUniqueOrThrow({ where: { id }, include: LICENSE_INCLUDE })));
}
