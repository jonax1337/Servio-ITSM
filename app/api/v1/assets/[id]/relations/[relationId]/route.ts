import { db } from "@/lib/db";
import { guard, ok, apiError, preflight, principalIsAgent } from "@/lib/api";
import { deleteAssetRelation } from "@/lib/actions/assets";
import { formOf } from "@/lib/api-itsm-input";
import { asActor, refusal } from "../../../../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Remove one edge. It must touch this asset (either end), so an id from another asset is a 404. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; relationId: string }> }) {
  const auth = await guard(req, "write");
  if ("response" in auth) return auth.response;
  if (!principalIsAgent(auth.principal)) return apiError(403, "Assets are restricted to agent tokens.");
  const { id, relationId } = await ctx.params;
  const rel = await db.assetRelation.findUnique({ where: { id: relationId }, select: { sourceId: true, targetId: true } });
  if (!rel || (rel.sourceId !== id && rel.targetId !== id)) return apiError(404, "Relationship not found");

  const result = await asActor(auth.principal, () => deleteAssetRelation(formOf({ relationId, assetId: id })));
  if (!result.ok) return refusal(result.error ?? "The relationship could not be removed.");
  return ok({ id: relationId, deleted: true });
}
