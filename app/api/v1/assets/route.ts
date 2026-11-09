import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { guard, ok, apiError, preflight, paginate, pageMeta, principalIsAgent } from "@/lib/api";
import { assetCreateSchema } from "@/lib/api-asset-input";
import { ASSET_INCLUDE, serializeAsset } from "../_serializers";
import { assetReferenceErrors, assetResponse, createAssetRecord, readAssetBody, uniqueConflict } from "../_assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * List assets. Filters: `type`, `status`, `q` (name, tag, serial), and exact
 * matches for syncs: `serial`, `asset_tag`, `ip_address`, `mac_address`,
 * `import_ref`, `owner_id`, `group_id`, `updated_since` (ISO time).
 */
export async function GET(req: Request) {
  const auth = await guard(req, "cmdb:read");
  if ("response" in auth) return auth.response;
  // The CMDB is agent data. Non-agent tokens must not enumerate assets (BOLA).
  if (!principalIsAgent(auth.principal)) return apiError(403, "Assets are restricted to agent tokens.");

  const p = new URL(req.url).searchParams;
  const { page, perPage, skip, take } = paginate(p);

  const where: Prisma.AssetWhereInput = {};
  if (p.get("type")) where.type = p.get("type")!;
  if (p.get("status")) where.status = p.get("status")!;
  const q = p.get("q");
  if (q) where.OR = [{ name: { contains: q } }, { assetTag: { contains: q } }, { serial: { contains: q } }];
  const exact: [string, keyof Prisma.AssetWhereInput][] = [
    ["serial", "serial"], ["asset_tag", "assetTag"], ["ip_address", "ipAddress"], ["mac_address", "macAddress"],
    ["import_ref", "importRef"], ["owner_id", "ownerId"], ["group_id", "groupId"],
  ];
  for (const [param, field] of exact) {
    const v = p.get(param);
    if (v) (where as Record<string, unknown>)[field] = v;
  }
  const since = p.get("updated_since");
  if (since) {
    const d = new Date(since);
    if (Number.isNaN(d.getTime())) return apiError(422, "Validation failed", { updated_since: ["Must be an ISO date/time"] });
    where.updatedAt = { gte: d };
  }

  const [total, assets] = await Promise.all([
    db.asset.count({ where }),
    db.asset.findMany({ where, include: ASSET_INCLUDE, orderBy: { name: "asc" }, skip, take }),
  ]);

  return ok(assets.map(serializeAsset), { meta: pageMeta(page, perPage, total) });
}

/** Create an asset. Every field of the asset form is accepted; unknown owner/group/location ids are a 422, a taken asset tag or import ref a 409. */
export async function POST(req: Request) {
  const auth = await guard(req, "cmdb:write");
  if ("response" in auth) return auth.response;
  if (!principalIsAgent(auth.principal)) return apiError(403, "Assets are restricted to agent tokens.");

  const body = await readAssetBody(req, assetCreateSchema);
  if ("response" in body) return body.response;
  const refs = await assetReferenceErrors(body.data);
  if (refs) return apiError(422, "Validation failed", refs);

  try {
    const asset = await createAssetRecord(body.data, auth.principal.userId, "Created via API");
    return assetResponse(asset, { status: 201 });
  } catch (err) {
    const conflict = uniqueConflict(err);
    if (conflict) return conflict;
    throw err;
  }
}
