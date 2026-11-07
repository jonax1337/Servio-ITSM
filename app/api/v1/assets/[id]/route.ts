import { db } from "@/lib/db";
import { guard, apiError, preflight, principalIsAgent } from "@/lib/api";
import { assetPatchSchema } from "@/lib/api-asset-input";
import { ASSET_INCLUDE } from "../../_serializers";
import { assetReferenceErrors, assetResponse, readAssetBody, uniqueConflict, updateAssetRecord } from "../../_assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guard(req, "read");
  if ("response" in auth) return auth.response;
  if (!principalIsAgent(auth.principal)) return apiError(403, "Assets are restricted to agent tokens.");
  const { id } = await ctx.params;

  const asset = await db.asset.findUnique({ where: { id }, include: ASSET_INCLUDE });
  if (!asset) return apiError(404, "Asset not found");
  return assetResponse(asset);
}

/**
 * Update any asset field (`null` clears a nullable one). Only values that
 * actually change are written and audited; the response's `meta.changed`
 * lists them.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guard(req, "write");
  if ("response" in auth) return auth.response;
  if (!principalIsAgent(auth.principal)) return apiError(403, "Assets are restricted to agent tokens.");
  const { id } = await ctx.params;

  const existing = await db.asset.findUnique({ where: { id } });
  if (!existing) return apiError(404, "Asset not found");

  const body = await readAssetBody(req, assetPatchSchema);
  if ("response" in body) return body.response;
  const refs = await assetReferenceErrors(body.data);
  if (refs) return apiError(422, "Validation failed", refs);

  try {
    const { asset, changed } = await updateAssetRecord(id, existing, body.data, auth.principal.userId, "API");
    return assetResponse(asset, { meta: { changed } });
  } catch (err) {
    const conflict = uniqueConflict(err);
    if (conflict) return conflict;
    throw err;
  }
}
