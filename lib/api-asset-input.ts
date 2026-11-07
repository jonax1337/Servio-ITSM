/**
 * Request bodies of the asset (CMDB), relation, vendor and license endpoints of
 * /api/v1. Pure and DB-free, so the contract is unit-testable.
 *
 * Asset bodies keep the existing camelCase field names (`ipAddress`); snake_case
 * is accepted too through lib/api-case.ts. The new sub-resources (relations,
 * vendors, licenses) are snake_case and strict like the ITSM endpoints.
 */
import { z } from "zod";
import { ASSET_RELATION_TYPES, ASSET_STATUSES, ASSET_TYPES, LICENSE_TYPES } from "@/lib/constants";

/** Trimmed text; an empty string means "no value" (stored as null). */
const text = z.string().trim().max(2000).transform((v) => (v === "" ? null : v));
const nullableText = text.nullable();
const nullableId = z.string().min(1).nullable();
const count = z.number().int().min(0).max(1_000_000).nullable();
/** A calendar date ("2026-03-31") or a full ISO time with offset. */
const dateOrTime = z.union([z.iso.date(), z.iso.datetime({ offset: true })]).nullable();

/** Every writable asset field, all optional. Shared by create, patch and upsert. */
const assetFields = {
  name: z.string().trim().min(1).max(200),
  type: z.enum(ASSET_TYPES),
  status: z.enum(ASSET_STATUSES),
  assetTag: nullableText,
  serial: nullableText,
  model: nullableText,
  manufacturer: nullableText,
  location: nullableText,
  locationId: nullableId,
  ipAddress: nullableText,
  macAddress: nullableText,
  os: nullableText,
  cpu: nullableText,
  ramGb: count,
  storageGb: count,
  cost: z.number().min(0).max(1e9).nullable(),
  purchaseDate: dateOrTime,
  warrantyEnd: dateOrTime,
  notes: z.string().max(20_000).nullable(),
  ownerId: nullableId,
  groupId: nullableId,
  lastSeenAt: dateOrTime,
};

const optionalAll = Object.fromEntries(Object.entries(assetFields).map(([k, s]) => [k, s.optional()])) as {
  [K in keyof typeof assetFields]: z.ZodOptional<(typeof assetFields)[K]>;
};

export const assetCreateSchema = z.object({
  ...optionalAll,
  name: assetFields.name,
  type: assetFields.type.optional().default("SERVER"),
  status: assetFields.status.optional().default("IN_USE"),
  externalId: z.string().optional(),
  syncSourceId: z.string().optional(),
  importRef: z.string().trim().min(1).max(200).optional(),
});

export const assetPatchSchema = z
  .object(optionalAll)
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

/**
 * Body of PUT /assets/ref/{ref}: the fields to set. On create `name` is
 * required (type/status default like POST); on update only the fields sent are
 * written. Strict, because it is meant for syncs, where a typo should fail.
 */
export const assetUpsertSchema = z.strictObject(optionalAll).refine((b) => Object.keys(b).length > 0, { message: "Nothing to write" });

export type AssetCreate = z.infer<typeof assetCreateSchema>;
export type AssetPatch = z.infer<typeof assetPatchSchema>;

const DATE_FIELDS = ["purchaseDate", "warrantyEnd", "lastSeenAt"] as const;

/** Prisma data from a validated body: ISO strings become Dates, everything else passes through. */
export function assetData<T extends Record<string, unknown>>(body: T): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  for (const key of DATE_FIELDS) {
    const v = out[key];
    if (typeof v === "string") out[key] = new Date(v);
  }
  return out;
}

/** The fields whose value actually changes, for the audit trail and the response. */
export function changedAssetFields(before: Record<string, unknown>, data: Record<string, unknown>): string[] {
  const norm = (x: unknown) => (x instanceof Date ? x.toISOString() : x ?? null);
  return Object.keys(data).filter((k) => norm(before[k]) !== norm(data[k]));
}

/** The ids an asset body references, to check for existence before writing (422, not a 500 on the FK). */
export function assetReferences(body: Record<string, unknown>) {
  const pick = (k: string) => (typeof body[k] === "string" && body[k] ? (body[k] as string) : null);
  return { ownerId: pick("ownerId"), groupId: pick("groupId"), locationId: pick("locationId") };
}

// ── Relations ────────────────────────────────────────────────────────────────

export const relationCreateSchema = z.strictObject({
  target_id: z.string().min(1),
  type: z.enum(ASSET_RELATION_TYPES).optional().default("DEPENDS_ON"),
});

// ── Vendors ──────────────────────────────────────────────────────────────────

export const vendorCreateSchema = z.strictObject({
  name: z.string().trim().min(2).max(200),
  website: z.string().trim().max(500).optional(),
  email: z.email().optional(),
  phone: z.string().trim().max(100).optional(),
  notes: z.string().max(20_000).optional(),
});

export const vendorPatchSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(200).optional(),
    website: z.string().trim().max(500).nullable().optional(),
    email: z.email().nullable().optional(),
    phone: z.string().trim().max(100).nullable().optional(),
    notes: z.string().max(20_000).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

// ── Licenses ─────────────────────────────────────────────────────────────────

const licenseFields = {
  name: z.string().trim().min(2).max(200),
  vendor_id: z.string().min(1).nullable(),
  contract_id: z.string().min(1).nullable(),
  owner_id: z.string().min(1).nullable(),
  license_type: z.enum(LICENSE_TYPES),
  seats: z.number().int().min(1).max(1_000_000),
  expires_at: z.iso.date().nullable(),
  cost: z.number().min(0).max(1e9).nullable(),
  notes: z.string().max(20_000).nullable(),
};

export const licenseCreateSchema = z.strictObject({
  name: licenseFields.name,
  vendor_id: licenseFields.vendor_id.optional(),
  contract_id: licenseFields.contract_id.optional(),
  owner_id: licenseFields.owner_id.optional(),
  license_type: licenseFields.license_type.optional().default("PER_USER"),
  seats: licenseFields.seats.optional().default(1),
  expires_at: licenseFields.expires_at.optional(),
  cost: licenseFields.cost.optional(),
  notes: licenseFields.notes.optional(),
});

export const licensePatchSchema = z
  .strictObject(Object.fromEntries(Object.entries(licenseFields).map(([k, s]) => [k, s.optional()])) as {
    [K in keyof typeof licenseFields]: z.ZodOptional<(typeof licenseFields)[K]>;
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

export const licenseAssignSchema = z
  .strictObject({ asset_id: z.string().min(1).optional(), user_id: z.string().min(1).optional() })
  .refine((b) => Boolean(b.asset_id || b.user_id), { message: "Give asset_id, user_id or both" });

type LicenseRow = {
  name: string; vendorId: string | null; contractId: string | null; ownerId: string | null; licenseType: string;
  seats: number; expiresAt: Date | null; cost: number | null; notes: string | null;
};

/**
 * The full form the console's license actions expect (they replace every field),
 * from the current row plus the fields a PATCH changes.
 */
export function licenseForm(current: LicenseRow | null, b: Partial<Record<keyof typeof licenseFields, unknown>>): Record<string, string> {
  const pick = <T,>(key: keyof typeof licenseFields, fallback: T) => (key in b ? (b[key] as T) : fallback);
  const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    name: s(pick("name", current?.name)),
    vendorId: s(pick("vendor_id", current?.vendorId)),
    contractId: s(pick("contract_id", current?.contractId)),
    ownerId: s(pick("owner_id", current?.ownerId)),
    licenseType: s(pick("license_type", current?.licenseType ?? "PER_USER")),
    seats: s(pick("seats", current?.seats ?? 1)),
    expiresAt: "expires_at" in b ? s(b.expires_at) : date(current?.expiresAt ?? null),
    cost: s(pick("cost", current?.cost)),
    notes: s(pick("notes", current?.notes)),
  };
}
