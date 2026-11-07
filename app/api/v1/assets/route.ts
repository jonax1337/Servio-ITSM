import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard, ok, apiError, preflight, paginate, pageMeta, principalIsAgent } from "@/lib/api";
import { camelizeBody } from "@/lib/api-case";
import { writeAudit } from "@/lib/audit";
import { serializeAsset } from "../_serializers";
import { ASSET_TYPES, ASSET_STATUSES } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const auth = await guard(req, "read");
  if ("response" in auth) return auth.response;
  // The CMDB is agent data. Non-agent tokens must not enumerate assets (BOLA).
  if (!principalIsAgent(auth.principal)) return apiError(403, "Assets are restricted to agent tokens.");

  const url = new URL(req.url);
  const { page, perPage, skip, take } = paginate(url.searchParams);

  const where: Prisma.AssetWhereInput = {};
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q");
  if (type) where.type = type;
  if (status) where.status = status;
  if (q) where.OR = [{ name: { contains: q } }, { assetTag: { contains: q } }, { serial: { contains: q } }];

  const [total, assets] = await Promise.all([
    db.asset.count({ where }),
    db.asset.findMany({ where, include: { owner: true }, orderBy: { name: "asc" }, skip, take }),
  ]);

  return ok(assets.map(serializeAsset), { meta: pageMeta(page, perPage, total) });
}

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(ASSET_TYPES).optional().default("SERVER"),
  status: z.enum(ASSET_STATUSES).optional().default("IN_USE"),
  assetTag: z.string().optional(),
  serial: z.string().optional(),
  model: z.string().optional(),
  manufacturer: z.string().optional(),
  location: z.string().optional(),
  ipAddress: z.string().optional(),
  os: z.string().optional(),
  externalId: z.string().optional(),
  syncSourceId: z.string().optional(),
});

export async function POST(req: Request) {
  const auth = await guard(req, "write");
  if ("response" in auth) return auth.response;
  if (!principalIsAgent(auth.principal)) return apiError(403, "Assets are restricted to agent tokens.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body");
  }
  // snake_case keys are accepted too (lib/api-case.ts).
  const normalized = camelizeBody(body);
  if ("conflict" in normalized) return apiError(422, "Validation failed", { _: normalized.conflict.map((c) => `Conflicting values for ${c}`) });
  const parsed = createSchema.safeParse(normalized.body);
  if (!parsed.success) return apiError(422, "Validation failed", parsed.error.flatten().fieldErrors);

  const asset = await db.asset.create({ data: parsed.data, include: { owner: true } });
  await writeAudit({ userId: auth.principal.userId, action: "CREATE", entity: "Asset", entityId: asset.id, summary: "Created via API" });

  return ok(serializeAsset(asset), { status: 201 });
}
