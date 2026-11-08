import "server-only";

import { db } from "@/lib/db";
import type { ServiceField } from "@/lib/service-forms";

/** Asset states that no longer count as "my device". */
const GONE_ASSET_STATUSES = ["RETIRED", "DISPOSED"];

export const NOT_YOUR_DEVICE = "Choose one of your own devices.";
export const UNKNOWN_PERSON = "Not everyone was found. Use the email address of a colleague who can sign in.";

/** How an asset is shown in a form answer: its tag and name. */
export function assetLabel(asset: { assetTag: string | null; name: string }): string {
  return asset.assetTag ? `${asset.assetTag} · ${asset.name}` : asset.name;
}

/** The requester's own devices, for the "asset" question of a catalog form. */
export function listOwnAssets(userId: string) {
  return db.asset.findMany({
    where: { ownerId: userId, status: { notIn: GONE_ASSET_STATUSES } },
    select: { id: true, name: true, assetTag: true },
    orderBy: { name: "asc" },
    take: 200,
  });
}

/**
 * Resolve the questions that link records to the new ticket. An "asset" answer (an
 * id from the portal form, or a tag, name or label from the assistant or a
 * re-request) must be one of the requester's own devices and is stored as its label;
 * a "people" answer (emails) must name active accounts, which become participants.
 * `values` is updated in place; the ids to link are returned, or field errors.
 */
export async function resolveCatalogFormLinks(
  requesterId: string,
  fields: ServiceField[],
  values: Record<string, unknown>,
): Promise<{ assetIds: string[]; participantIds: string[]; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const assetIds: string[] = [];
  const participantIds = new Set<string>();
  const own = fields.some((f) => f.type === "asset") ? await listOwnAssets(requesterId) : [];

  for (const f of fields) {
    const v = values[f.key];
    if (f.type === "asset" && typeof v === "string" && v) {
      const asset = own.find((a) => a.id === v || a.assetTag === v || a.name === v || assetLabel(a) === v);
      if (!asset) errors[f.key] = NOT_YOUR_DEVICE;
      else {
        assetIds.push(asset.id);
        values[f.key] = assetLabel(asset);
      }
    }
    if (f.type === "people" && Array.isArray(v) && v.length > 0) {
      const emails = v.map(String);
      const users = await db.user.findMany({ where: { email: { in: emails }, isActive: true }, select: { id: true, email: true } });
      if (users.length < emails.length) errors[f.key] = UNKNOWN_PERSON;
      for (const u of users) if (u.id !== requesterId) participantIds.add(u.id);
    }
  }
  return { assetIds: [...new Set(assetIds)], participantIds: [...participantIds], errors };
}
