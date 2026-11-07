import { db } from "@/lib/db";
import { guard, ok, apiError, preflight, principalIsAgent } from "@/lib/api";
import { addAssetRelation } from "@/lib/actions/assets";
import { formOf } from "@/lib/api-itsm-input";
import { relationCreateSchema } from "@/lib/api-asset-input";
import { serializeAssetRelation } from "../../../_serializers";
import { asActor, readBody, refusal } from "../../../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENDPOINT = { select: { id: true, name: true, type: true } } as const;

export function OPTIONS() {
  return preflight();
}

async function relationsOf(assetId: string) {
  const rows = await db.assetRelation.findMany({
    where: { OR: [{ sourceId: assetId }, { targetId: assetId }] },
    include: { source: ENDPOINT, target: ENDPOINT },
    orderBy: { type: "asc" },
  });
  return rows.map((r) => serializeAssetRelation(r, assetId));
}

/** The asset's dependency edges in both directions (`direction`: outgoing = this asset is the source). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guard(req, "read");
  if ("response" in auth) return auth.response;
  if (!principalIsAgent(auth.principal)) return apiError(403, "Assets are restricted to agent tokens.");
  const { id } = await ctx.params;
  if (!(await db.asset.findUnique({ where: { id }, select: { id: true } }))) return apiError(404, "Asset not found");
  return ok(await relationsOf(id));
}

/**
 * Add an edge from this asset to `target_id` (`type` default DEPENDS_ON), through
 * the console's addAssetRelation: no self-links, both ends must exist, an
 * existing identical edge is kept (idempotent).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guard(req, "write");
  if ("response" in auth) return auth.response;
  if (!principalIsAgent(auth.principal)) return apiError(403, "Assets are restricted to agent tokens.");
  const { id } = await ctx.params;
  if (!(await db.asset.findUnique({ where: { id }, select: { id: true } }))) return apiError(404, "Asset not found");
  const body = await readBody(req, relationCreateSchema);
  if ("response" in body) return body.response;

  const result = await asActor(auth.principal, () => addAssetRelation(formOf({ sourceId: id, targetId: body.data.target_id, type: body.data.type })));
  if (!result.ok) return refusal(result.error ?? "The relationship was refused.");
  return ok(await relationsOf(id), { status: 201 });
}
