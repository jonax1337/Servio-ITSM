import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { servicesAffectedByAssets } from "@/lib/service-graph";
import { agentGuard } from "../../../_itsm";
import { serializeImpact } from "../../../_services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * The services an outage of this asset hits: `direct` ones run on it, the
 * others are reached through the assets it takes down or through service
 * dependencies (nearest first). Links are managed on the service
 * (`asset_ids` of PATCH /services/{id}).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "cmdb:read");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  if (!(await db.asset.findUnique({ where: { id }, select: { id: true } }))) return apiError(404, "Asset not found");
  return ok((await servicesAffectedByAssets([id])).map(serializeImpact));
}
