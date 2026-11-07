import { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, apiError } from "@/lib/api";
import { camelizeBody } from "@/lib/api-case";
import { writeAudit } from "@/lib/audit";
import { assetData, assetReferences, changedAssetFields } from "@/lib/api-asset-input";
import { ASSET_INCLUDE, serializeAsset } from "./_serializers";

/** Parse an asset body: camelCase or snake_case keys (lib/api-case.ts), then the schema. */
export async function readAssetBody<S extends z.ZodType>(req: Request, schema: S): Promise<{ data: z.infer<S> } | { response: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { response: apiError(400, "Invalid JSON body") };
  }
  const normalized = camelizeBody(body);
  if ("conflict" in normalized) {
    return { response: apiError(422, "Validation failed", { _: normalized.conflict.map((c) => `Conflicting values for ${c}`) }) };
  }
  const parsed = schema.safeParse(normalized.body);
  if (!parsed.success) {
    const flat = (parsed.error as z.ZodError).flatten();
    return { response: apiError(422, "Validation failed", { ...flat.fieldErrors, ...(flat.formErrors.length ? { _: flat.formErrors } : {}) }) };
  }
  return { data: parsed.data };
}

/** 422 details for owner/group/location ids that do not exist, or null. */
export async function assetReferenceErrors(body: Record<string, unknown>): Promise<Record<string, string[]> | null> {
  const { ownerId, groupId, locationId } = assetReferences(body);
  const [owner, group, location] = await Promise.all([
    ownerId ? db.user.findUnique({ where: { id: ownerId }, select: { id: true } }) : true,
    groupId ? db.group.findUnique({ where: { id: groupId }, select: { id: true } }) : true,
    locationId ? db.location.findUnique({ where: { id: locationId }, select: { id: true } }) : true,
  ]);
  const errors: Record<string, string[]> = {};
  if (!owner) errors.ownerId = [`Unknown user: ${ownerId}`];
  if (!group) errors.groupId = [`Unknown group: ${groupId}`];
  if (!location) errors.locationId = [`Unknown location: ${locationId}`];
  return Object.keys(errors).length ? errors : null;
}

/** A unique-constraint violation (asset tag, import ref, sync key) as a 409 naming the field. */
export function uniqueConflict(err: unknown): NextResponse | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = ([] as string[]).concat((err.meta?.target as string[] | string | undefined) ?? []).join(", ") || "a unique field";
    return apiError(409, `Another asset already uses this value (${target}).`);
  }
  return null;
}

/** Create an asset and write its audit row. */
export async function createAssetRecord(data: Record<string, unknown>, actorId: string, summary: string) {
  const asset = await db.asset.create({ data: assetData(data) as Prisma.AssetUncheckedCreateInput, include: ASSET_INCLUDE });
  await writeAudit({ userId: actorId, action: "CREATE", entity: "Asset", entityId: asset.id, summary });
  return asset;
}

/**
 * Update the given fields of an asset. Only fields whose value changes are
 * written and audited, so a sync that re-sends the same facts every run leaves
 * no audit noise. Returns the asset and the changed field names.
 */
export async function updateAssetRecord(id: string, before: Record<string, unknown>, body: Record<string, unknown>, actorId: string, via: string) {
  const data = assetData(body);
  const changed = changedAssetFields(before, data);
  if (changed.length === 0) {
    const asset = await db.asset.findUniqueOrThrow({ where: { id }, include: ASSET_INCLUDE });
    return { asset, changed };
  }
  const patch = Object.fromEntries(changed.map((k) => [k, data[k]]));
  const asset = await db.asset.update({ where: { id }, data: patch, include: ASSET_INCLUDE });
  await writeAudit({ userId: actorId, action: "UPDATE", entity: "Asset", entityId: id, summary: `Edited ${changed.join(", ")} via ${via}`, meta: { changed } });
  return { asset, changed };
}

export function assetResponse(asset: Parameters<typeof serializeAsset>[0], init?: { status?: number; meta?: unknown }) {
  return ok(serializeAsset(asset), init);
}
