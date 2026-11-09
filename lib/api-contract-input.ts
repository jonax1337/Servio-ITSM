import { z } from "zod";
import { CONTRACT_STATUSES, CONTRACT_TYPES } from "@/lib/constants";
import { externalRefSchema } from "@/lib/ticket-external-ref";
import { contractDateError, contractExpiry, isoDay } from "@/lib/contract-rules";

/**
 * Request bodies of the /api/v1/contracts endpoints (snake_case, strict) and the
 * pure helpers the handlers share. The limits match the console's contract form
 * (lib/contract-schemas.ts). Shared with the OpenAPI route.
 */

const fields = {
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(200),
  /** The vendor's contract or agreement number. */
  number: z.string().trim().max(200).nullable(),
  type: z.enum(CONTRACT_TYPES),
  status: z.enum(CONTRACT_STATUSES),
  vendor_id: z.string().min(1).nullable(),
  /** Receives the renewal reminder. */
  owner_id: z.string().min(1).nullable(),
  /** A calendar day, e.g. "2026-01-01". */
  start_date: z.iso.date(),
  end_date: z.iso.date().nullable(),
  cost: z.number().min(0, "Cost can't be negative").max(1e12).nullable(),
  /** Days before end_date the owner is reminded. */
  renewal_notice_days: z.number().int().min(0).max(3650),
  auto_renew: z.boolean(),
  notes: z.string().max(20_000).nullable(),
  /** The assets the contract covers; replaces the whole set. */
  asset_ids: z.array(z.string().min(1)).max(1000),
};

type Fields = typeof fields;
const allOptional = Object.fromEntries(Object.entries(fields).map(([k, s]) => [k, s.optional()])) as {
  [K in keyof Fields]: z.ZodOptional<Fields[K]>;
};

export const contractCreateSchema = z.strictObject({
  ...allOptional,
  name: fields.name,
  start_date: fields.start_date,
  /** Origin key for a script-maintained contract; PUT /contracts/ref/{ref} upserts by it. */
  import_ref: externalRefSchema.optional(),
});

export const contractPatchSchema = z
  .strictObject({ ...allOptional, import_ref: externalRefSchema.nullable().optional() })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

/** PUT /contracts/ref/{ref}: the fields to set; `name` and `start_date` are required only for a new contract. */
export const contractUpsertSchema = z.strictObject(allOptional);

export type ContractPatch = z.infer<typeof contractPatchSchema>;
export type ContractUpsert = z.infer<typeof contractUpsertSchema>;

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

/** The Prisma columns for the fields present in a body (absent keys stay untouched); `asset_ids` is handled separately. */
export function contractData(b: Partial<ContractPatch>) {
  const blank = (v: string | null) => (v?.trim() ? v.trim() : null);
  return {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.number !== undefined && { number: blank(b.number) }),
    ...(b.type !== undefined && { type: b.type }),
    ...(b.status !== undefined && { status: b.status }),
    ...(b.vendor_id !== undefined && { vendorId: b.vendor_id }),
    ...(b.owner_id !== undefined && { ownerId: b.owner_id }),
    ...(b.start_date !== undefined && { startDate: day(b.start_date) }),
    ...(b.end_date !== undefined && { endDate: b.end_date === null ? null : day(b.end_date) }),
    ...(b.cost !== undefined && { cost: b.cost }),
    ...(b.renewal_notice_days !== undefined && { renewalNoticeDays: b.renewal_notice_days }),
    ...(b.auto_renew !== undefined && { autoRenew: b.auto_renew }),
    ...(b.notes !== undefined && { notes: blank(b.notes) }),
    ...(b.import_ref !== undefined && { importRef: b.import_ref }),
  };
}

/** The end date before the start date (of the contract that results from `data` on `current`), as an API field error, or null. */
export function contractDateProblem(
  current: { startDate: Date; endDate: Date | null } | null,
  data: ReturnType<typeof contractData>,
): Record<string, string[]> | null {
  const start = data.startDate ?? current?.startDate;
  const end = data.endDate !== undefined ? data.endDate : (current?.endDate ?? null);
  const problem = start ? contractDateError(start, end) : null;
  return problem ? { end_date: [problem] } : null;
}

/** Which assets to link and unlink so the contract covers exactly `wanted`. */
export function assetSetDiff(current: string[], wanted: string[]): { add: string[]; remove: string[] } {
  const want = new Set(wanted);
  const have = new Set(current);
  return { add: [...want].filter((id) => !have.has(id)), remove: [...have].filter((id) => !want.has(id)) };
}

export type ContractRow = {
  id: string; name: string; number: string | null; type: string; status: string; vendorId: string | null;
  ownerId: string | null; startDate: Date; endDate: Date | null; cost: number | null; renewalNoticeDays: number;
  autoRenew: boolean; notes: string | null; importRef: string | null; createdAt: Date; updatedAt: Date;
  vendor?: { id: string; name: string } | null;
  owner?: { id: string; name: string | null; email: string } | null;
  assets?: { asset: { id: string; name: string } }[];
};

export function serializeContract(c: ContractRow, now = new Date()) {
  return {
    id: c.id,
    name: c.name,
    number: c.number,
    type: c.type,
    status: c.status,
    vendor_id: c.vendorId,
    vendor: c.vendor ? { id: c.vendor.id, name: c.vendor.name } : null,
    owner_id: c.ownerId,
    owner: c.owner ? { id: c.owner.id, name: c.owner.name, email: c.owner.email } : null,
    start_date: isoDay(c.startDate),
    end_date: c.endDate ? isoDay(c.endDate) : null,
    /** NONE (no end date, draft or terminated) | OK | EXPIRING (within the notice period) | EXPIRED. */
    expiry: contractExpiry(c, now),
    cost: c.cost,
    renewal_notice_days: c.renewalNoticeDays,
    auto_renew: c.autoRenew,
    notes: c.notes,
    asset_ids: (c.assets ?? []).map((a) => a.asset.id),
    assets: (c.assets ?? []).map((a) => ({ id: a.asset.id, name: a.asset.name })),
    import_ref: c.importRef,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}
