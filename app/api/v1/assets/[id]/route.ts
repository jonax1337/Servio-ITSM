import { z } from "zod";
import { db } from "@/lib/db";
import { guard, ok, apiError, preflight, principalIsAgent } from "@/lib/api";
import { camelizeBody } from "@/lib/api-case";
import { writeAudit } from "@/lib/audit";
import { serializeAsset } from "../../_serializers";
import { ASSET_STATUSES, ASSET_TYPES } from "@/lib/constants";

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

  const asset = await db.asset.findUnique({ where: { id }, include: { owner: true } });
  if (!asset) return apiError(404, "Asset not found");
  return ok(serializeAsset(asset));
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(ASSET_TYPES).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  location: z.string().nullable().optional(),
  ipAddress: z.string().nullable().optional(),
  os: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guard(req, "write");
  if ("response" in auth) return auth.response;
  if (!principalIsAgent(auth.principal)) return apiError(403, "Assets are restricted to agent tokens.");
  const { id } = await ctx.params;

  const existing = await db.asset.findUnique({ where: { id } });
  if (!existing) return apiError(404, "Asset not found");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body");
  }
  // snake_case keys are accepted too (lib/api-case.ts).
  const normalized = camelizeBody(body);
  if ("conflict" in normalized) return apiError(422, "Validation failed", { _: normalized.conflict.map((c) => `Conflicting values for ${c}`) });
  const parsed = patchSchema.safeParse(normalized.body);
  if (!parsed.success) return apiError(422, "Validation failed", parsed.error.flatten().fieldErrors);

  const asset = await db.asset.update({ where: { id }, data: parsed.data, include: { owner: true } });
  await writeAudit({ userId: auth.principal.userId, action: "UPDATE", entity: "Asset", entityId: asset.id, summary: "Updated via API" });
  return ok(serializeAsset(asset));
}
