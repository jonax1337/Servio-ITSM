import { z } from "zod";
import { CRITICALITIES, SERVICE_STATUSES } from "@/lib/constants";
import { EXTERNAL_REF_HINT, EXTERNAL_REF_RE } from "@/lib/ticket-external-ref";

/**
 * Request bodies of POST /api/v1/services, PATCH /api/v1/services/{id} and
 * PUT /api/v1/services/ref/{ref} (snake_case and strict, like the other ITSM
 * endpoints: an unknown field is a 422). Pure and DB-free, so the contract is
 * unit-testable; shared with the OpenAPI route and the console actions.
 */

/** Short service number shown next to the name, e.g. "S-01". */
export const SERVICE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/;
export const SERVICE_CODE_HINT = "1-32 characters: letters, digits and . _ / -, starting with a letter or digit";

const id = z.string().min(1);
const nullableId = id.nullable();
const code = z.string().trim().regex(SERVICE_CODE_RE, SERVICE_CODE_HINT);
const ref = z.string().regex(EXTERNAL_REF_RE, EXTERNAL_REF_HINT);

/** One entry of `depends_on`: the service it needs, by id or by import ref, with an optional note. */
export const dependencyEntrySchema = z
  .strictObject({
    service_id: id.optional(),
    service_ref: ref.optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((d) => (d.service_id === undefined) !== (d.service_ref === undefined), {
    message: "Give exactly one of service_id or service_ref",
  });

const MAX_LINKS = 500;

const serviceFields = {
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  /** null clears it. */
  code: code.nullable(),
  description: z.string().trim().max(20_000).nullable(),
  status: z.enum(SERVICE_STATUSES),
  criticality: z.enum(CRITICALITIES),
  icon: z.string().trim().max(60).nullable(),
  category_id: nullableId,
  owner_id: nullableId,
  sla_id: nullableId,
  /** The team that runs the service (pre-routes catalog requests). */
  group_id: nullableId,
  /** The supporting configuration items. Replaces the whole set; [] unlinks all. */
  asset_ids: z.array(id).max(MAX_LINKS),
  /** The services this one needs. Replaces the whole set; [] removes all. */
  depends_on: z.array(dependencyEntrySchema).max(MAX_LINKS),
};

const optionalFields = Object.fromEntries(Object.entries(serviceFields).map(([k, s]) => [k, s.optional()])) as {
  [K in keyof typeof serviceFields]: z.ZodOptional<(typeof serviceFields)[K]>;
};

export const serviceCreateSchema = z.strictObject({
  ...optionalFields,
  name: serviceFields.name,
  /** Origin key for later upserts through PUT /services/ref/{ref}. */
  import_ref: ref.optional(),
});

export const servicePatchSchema = z
  .strictObject(optionalFields)
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

/**
 * Body of PUT /services/ref/{ref}: `name` is required when the reference is
 * new; on an existing service only the fields sent are written.
 */
export const serviceUpsertSchema = z
  .strictObject(optionalFields)
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to write" });

export type ServiceCreate = z.infer<typeof serviceCreateSchema>;
export type ServicePatch = z.infer<typeof servicePatchSchema>;
export type DependencyEntry = z.infer<typeof dependencyEntrySchema>;

/** The scalar columns (no links) a body sets, as Prisma data. Absent keys stay untouched. */
export function serviceData(b: ServicePatch) {
  return {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.code !== undefined && { code: b.code || null }),
    ...(b.description !== undefined && { description: b.description || null }),
    ...(b.status !== undefined && { status: b.status }),
    ...(b.criticality !== undefined && { criticality: b.criticality }),
    ...(b.icon !== undefined && { icon: b.icon || null }),
    ...(b.category_id !== undefined && { categoryId: b.category_id }),
    ...(b.owner_id !== undefined && { ownerId: b.owner_id }),
    ...(b.sla_id !== undefined && { slaId: b.sla_id }),
    ...(b.group_id !== undefined && { groupId: b.group_id }),
  };
}

/** The scalar columns whose value actually changes (for `meta.changed`, the audit row and the no-op upsert). */
export function changedServiceColumns(before: Record<string, unknown>, data: Record<string, unknown>): string[] {
  return Object.keys(data).filter((k) => (before[k] ?? null) !== (data[k] ?? null));
}

/** Repeated entries in a list of ids (the same asset or service twice is a 422, not silently merged). */
export function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of ids) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}
