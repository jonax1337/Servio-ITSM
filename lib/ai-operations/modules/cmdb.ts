import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { resolveGroupId, resolveAgentId } from "@/lib/ai-tools";
import { updateAssetField } from "@/lib/actions/assets";
import { createLocation, updateLocation, deleteLocation } from "@/lib/actions/locations";
import { ASSET_TYPES, ASSET_STATUSES, LOCATION_TYPES } from "@/lib/constants";
import type { AiOperation } from "../types";
import { ok, err, str, toFormData, coerceEnum } from "../helpers";

/**
 * CMDB: Assets + Locations. Asset writes go direct-to-Prisma (asset.create) or
 * reuse the app's real field action (updateAssetField); Location writes reuse the
 * non-redirecting form actions (createLocation/updateLocation/deleteLocation),
 * which already write audit + revalidate. RBAC mirrors the underlying actions
 * (AGENT). Names are resolved to ids server-side (never model-supplied ids).
 */

/** Find a location by (contains) name; returns { id, name } or null. */
async function findLocation(name: string) {
  const q = name.trim();
  return db.location.findFirst({
    where: { OR: [{ name: q }, { name: { contains: q } }] },
    select: { id: true, name: true },
  });
}

/**
 * Deterministically resolve a single asset for a write op: exact name (or
 * unique assetTag) only — never a fuzzy `contains`, which can silently hit the
 * wrong record ("SRV-1" must not mutate "SRV-12"). If an exact name matches
 * more than one asset, refuse and ask for the asset tag instead.
 */
async function resolveAsset(ref: string): Promise<{ asset: { id: string; name: string } } | { error: string }> {
  const select = { id: true, name: true } as const;
  const q = ref.trim();
  if (!q) return { error: "Asset name is required." };

  const byTag = await db.asset.findFirst({ where: { assetTag: q }, select });
  if (byTag) return { asset: byTag };

  // Exact name match only — fetch up to 2 to detect ambiguity.
  const matches = await db.asset.findMany({ where: { name: q }, select, take: 2 });
  if (matches.length === 0) return { error: `Asset not found: ${q}` };
  if (matches.length > 1) {
    return { error: `Multiple assets are named "${q}". Please specify the asset's tag to disambiguate.` };
  }
  return { asset: matches[0] };
}

export const OPERATIONS: AiOperation[] = [
  {
    id: "asset.create",
    group: "Assets",
    kind: "write",
    minRole: "AGENT",
    description:
      "Create a configuration item / asset (server, laptop, network device, software, etc.). " +
      "Optionally set an owner (person by name) and owning team (by name), plus hardware details.",
    input: z.object({
      name: z.string().min(2).describe("asset name"),
      type: z.string().describe(`asset type: ${ASSET_TYPES.join(", ")}`),
      status: z.string().optional().describe(`asset status: ${ASSET_STATUSES.join(", ")} (default IN_USE)`),
      assetTag: z.string().optional(),
      serial: z.string().optional(),
      model: z.string().optional(),
      manufacturer: z.string().optional(),
      os: z.string().optional().describe("operating system"),
      ipAddress: z.string().optional(),
      owner: z.string().optional().describe("owner (person's name)"),
      team: z.string().optional().describe("owning team name"),
    }),
    label: (a) => `Create asset “${String(a.name)}”`,
    run: async (a, ctx) => {
      const name = str(a.name);
      if (!name || name.length < 2) return err("Asset name is too short.");
      const type = coerceEnum(a.type, ASSET_TYPES);
      if (!type) return err(`Invalid asset type "${String(a.type)}". Allowed: ${ASSET_TYPES.join(", ")}.`);
      const status = str(a.status) ? coerceEnum(a.status, ASSET_STATUSES) : "IN_USE";
      if (!status) return err(`Invalid asset status "${String(a.status)}". Allowed: ${ASSET_STATUSES.join(", ")}.`);

      let ownerId: string | undefined;
      if (str(a.owner)) {
        const owner = await resolveAgentId(String(a.owner));
        if (!owner) return err(`Owner not found: ${String(a.owner)}`);
        ownerId = owner.id;
      }
      let groupId: string | undefined;
      if (str(a.team)) {
        const team = await resolveGroupId(String(a.team));
        if (!team) return err(`Team not found: ${String(a.team)}`);
        groupId = team.id;
      }

      const row = await db.asset.create({
        data: {
          name,
          type,
          status,
          assetTag: str(a.assetTag) ?? null,
          serial: str(a.serial) ?? null,
          model: str(a.model) ?? null,
          manufacturer: str(a.manufacturer) ?? null,
          os: str(a.os) ?? null,
          ipAddress: str(a.ipAddress) ?? null,
          ownerId: ownerId ?? null,
          groupId: groupId ?? null,
        },
        select: { id: true },
      });
      await writeAudit({
        userId: ctx.userId,
        action: "CREATE",
        entity: "Asset",
        entityId: row.id,
        summary: `Created asset "${name}" via Sable`,
      });
      return ok(`Created asset "${name}"`);
    },
  },
  {
    id: "asset.update_field",
    group: "Assets",
    kind: "write",
    minRole: "AGENT",
    description:
      "Update a single field on an existing asset (identified by its name). " +
      "Set its status, its owner (person by name), or its owning team (by name).",
    input: z.object({
      asset: z.string().describe("the asset's name"),
      field: z.enum(["status", "owner", "team"]).describe("which field to change"),
      value: z.string().describe(`new value: status ${ASSET_STATUSES.join("/")}, or a person/team name`),
    }),
    label: (a) => `Set ${String(a.field)} of asset “${String(a.asset)}”`,
    run: async (a, ctx) => {
      const assetName = str(a.asset);
      if (!assetName) return err("Asset name is required.");
      const resolved = await resolveAsset(assetName);
      if ("error" in resolved) return err(resolved.error);
      const asset = resolved.asset;

      const field = String(a.field);
      const rawValue = str(a.value);
      if (!rawValue) return err("A value is required.");

      let dbField: "status" | "ownerId" | "groupId";
      let value: string;

      if (field === "owner") {
        dbField = "ownerId";
        const owner = await resolveAgentId(rawValue);
        if (!owner) return err(`Owner not found: ${rawValue}`);
        value = owner.id;
      } else if (field === "team") {
        dbField = "groupId";
        const team = await resolveGroupId(rawValue);
        if (!team) return err(`Team not found: ${rawValue}`);
        value = team.id;
      } else {
        dbField = "status";
        const status = coerceEnum(rawValue, ASSET_STATUSES);
        if (!status) return err(`Invalid status "${rawValue}". Allowed: ${ASSET_STATUSES.join(", ")}.`);
        value = status;
      }

      await updateAssetField(toFormData({ id: asset.id, field: dbField, value }));
      await writeAudit({
        userId: ctx.userId,
        action: "UPDATE",
        entity: "Asset",
        entityId: asset.id,
        summary: `Updated ${dbField} of asset "${asset.name}" via Sable`,
      });
      return ok(`Updated ${field} of asset "${asset.name}"`);
    },
  },
  {
    id: "location.create",
    group: "Locations",
    kind: "write",
    minRole: "AGENT",
    description:
      "Create a location (site, building, floor, room, datacenter, or rack). " +
      "Optionally nest it under a parent location (by name) and add an address.",
    input: z.object({
      name: z.string().min(2).describe("location name"),
      type: z.string().describe(`location type: ${LOCATION_TYPES.join(", ")}`),
      parent: z.string().optional().describe("parent location name; pass 'none' for no parent"),
      address: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      notes: z.string().optional(),
    }),
    label: (a) => `Create location “${String(a.name)}”`,
    run: async (a, _ctx) => {
      const name = str(a.name);
      if (!name || name.length < 2) return err("Location name is too short.");
      const type = coerceEnum(a.type, LOCATION_TYPES);
      if (!type) return err(`Invalid location type "${String(a.type)}". Allowed: ${LOCATION_TYPES.join(", ")}.`);

      let parentId: string | undefined;
      const parentRaw = str(a.parent);
      if (parentRaw && parentRaw.toLowerCase() !== "none") {
        const parent = await findLocation(parentRaw);
        if (!parent) return err(`Parent location not found: ${parentRaw}`);
        parentId = parent.id;
      }

      const res = await createLocation(
        undefined,
        toFormData({
          name,
          type,
          parentId,
          address: str(a.address),
          city: str(a.city),
          country: str(a.country),
          notes: str(a.notes),
        }),
      );
      if (res?.error) return err(res.error);
      return ok(`Created location "${name}"`);
    },
  },
  {
    id: "location.update",
    group: "Locations",
    kind: "write",
    minRole: "AGENT",
    description:
      "Update an existing location (identified by its current name): rename, change its type, " +
      "re-parent it (parent by name, or 'none' to clear), or edit its address.",
    input: z.object({
      current: z.string().describe("the location's current name"),
      name: z.string().optional().describe("new name"),
      type: z.string().optional().describe(`new type: ${LOCATION_TYPES.join(", ")}`),
      parent: z.string().optional().describe("new parent location name; pass 'none' to clear"),
      address: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      notes: z.string().optional(),
    }),
    label: (a) => `Update location “${String(a.current)}”`,
    run: async (a, _ctx) => {
      const currentName = str(a.current);
      if (!currentName) return err("The location's current name is required.");
      const target = await findLocation(currentName);
      if (!target) return err(`Location not found: ${currentName}`);

      // updateLocation re-validates name+type via its own schema, so supply the
      // current values when the caller doesn't change them.
      const name = str(a.name) ?? target.name;

      let type: string | undefined;
      if (str(a.type)) {
        type = coerceEnum(a.type, LOCATION_TYPES) ?? undefined;
        if (!type) return err(`Invalid location type "${String(a.type)}". Allowed: ${LOCATION_TYPES.join(", ")}.`);
      }

      let parentId: string | undefined;
      const parentRaw = str(a.parent);
      if (parentRaw) {
        if (parentRaw.toLowerCase() === "none") parentId = "none";
        else {
          const parent = await findLocation(parentRaw);
          if (!parent) return err(`Parent location not found: ${parentRaw}`);
          if (parent.id === target.id) return err("A location cannot be its own parent.");
          parentId = parent.id;
        }
      }

      const res = await updateLocation(
        undefined,
        toFormData({
          id: target.id,
          name,
          type,
          parentId,
          address: str(a.address),
          city: str(a.city),
          country: str(a.country),
          notes: str(a.notes),
        }),
      );
      if (res?.error) return err(res.error);
      return ok(`Updated location "${target.name}"`);
    },
  },
  {
    id: "location.delete",
    group: "Locations",
    kind: "write",
    minRole: "AGENT",
    description:
      "Delete a location by name (its assets and child locations are detached, not deleted).",
    input: z.object({ name: z.string().describe("location name to delete") }),
    label: (a) => `Delete location “${String(a.name)}”`,
    run: async (a, ctx) => {
      const name = str(a.name);
      if (!name) return err("Location name is required.");
      const target = await findLocation(name);
      if (!target) return err(`Location not found: ${name}`);

      await deleteLocation(toFormData({ id: target.id }));
      await writeAudit({
        userId: ctx.userId,
        action: "DELETE",
        entity: "Location",
        entityId: target.id,
        summary: `Deleted location "${target.name}" via Sable`,
      });
      return ok(`Deleted location "${target.name}"`);
    },
  },
];
