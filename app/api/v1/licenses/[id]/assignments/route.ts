import { db } from "@/lib/db";
import { ok, apiError, preflight } from "@/lib/api";
import { assignLicense } from "@/lib/actions/contracts";
import { formOf } from "@/lib/api-itsm-input";
import { licenseAssignSchema } from "@/lib/api-asset-input";
import { LICENSE_INCLUDE, serializeLicense } from "../../../_serializers";
import { agentGuard, asActor, readBody, refusal } from "../../../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * Assign one seat to an asset, a user or both (MANAGER or above), through the
 * console's assignLicense: duplicates are refused; seats beyond the purchased
 * count are allowed and show as `over_allocated`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "cmdb:write");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  if (!(await db.softwareLicense.findUnique({ where: { id }, select: { id: true } }))) return apiError(404, "License not found");
  const body = await readBody(req, licenseAssignSchema);
  if ("response" in body) return body.response;
  const result = await asActor(auth.principal, () =>
    assignLicense(formOf({ licenseId: id, assetId: body.data.asset_id, userId: body.data.user_id })),
  );
  if (!result.ok) return refusal(result.error ?? "The request was refused.");
  return ok(serializeLicense(await db.softwareLicense.findUniqueOrThrow({ where: { id }, include: LICENSE_INCLUDE })), { status: 201 });
}
