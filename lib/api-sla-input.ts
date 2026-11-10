import { z } from "zod";
import { PRIORITIES } from "@/lib/constants";
import { EXTERNAL_REF_HINT, EXTERNAL_REF_RE } from "@/lib/ticket-external-ref";

/**
 * Request bodies of POST /api/v1/slas, PATCH /api/v1/slas/{id} and PUT /api/v1/slas/ref/{ref}
 * (snake_case and strict, like the other management endpoints: an unknown field is a 422). Pure and
 * DB-free, so the contract is unit-testable; shared with the OpenAPI route.
 */
const ref = z.string().regex(EXTERNAL_REF_RE, EXTERNAL_REF_HINT);
const MAX_MINUTES = 1_000_000;

const slaFields = {
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  /** null clears it. */
  description: z.string().trim().max(2000).nullable(),
  /** The ticket priority this SLA is picked for automatically; null = no priority match. */
  priority: z.enum(PRIORITIES).nullable(),
  response_mins: z.number().int().min(1, "Must be at least 1 minute").max(MAX_MINUTES),
  resolve_mins: z.number().int().min(1, "Must be at least 1 minute").max(MAX_MINUTES),
  /** The working-hours calendar the clock honours; null = the clock runs 24/7. Exclusive with `business_calendar_ref`. */
  business_calendar_id: z.string().min(1).nullable(),
  /** The calendar by its `import_ref`, for integrations that do not know ids. Exclusive with `business_calendar_id`. */
  business_calendar_ref: ref.nullable(),
  escalation_policy_id: z.string().min(1).nullable(),
  /** false = no longer picked for new tickets; running tickets keep their deadlines. */
  is_active: z.boolean(),
};

const optionalFields = Object.fromEntries(Object.entries(slaFields).map(([k, s]) => [k, s.optional()])) as {
  [K in keyof typeof slaFields]: z.ZodOptional<(typeof slaFields)[K]>;
};

const oneCalendarKey = (b: { business_calendar_id?: unknown; business_calendar_ref?: unknown }) =>
  b.business_calendar_id === undefined || b.business_calendar_ref === undefined;
const ONE_CALENDAR_KEY = { message: "Send either business_calendar_id or business_calendar_ref, not both." };

export const slaCreateSchema = z
  .strictObject({
    ...optionalFields,
    name: slaFields.name,
    response_mins: slaFields.response_mins,
    resolve_mins: slaFields.resolve_mins,
    /** Origin key for later upserts through PUT /slas/ref/{ref}. */
    import_ref: ref.optional(),
  })
  .refine(oneCalendarKey, ONE_CALENDAR_KEY);

export const slaPatchSchema = z
  .strictObject({
    ...optionalFields,
    /** Adopts an existing SLA into the reference scheme; null releases the reference. */
    import_ref: ref.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" })
  .refine(oneCalendarKey, ONE_CALENDAR_KEY);

/** Body of PUT /slas/ref/{ref}: `name`, `response_mins` and `resolve_mins` are required when the reference is new. */
export const slaUpsertSchema = z
  .strictObject(optionalFields)
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to write" })
  .refine(oneCalendarKey, ONE_CALENDAR_KEY);

export type SlaCreate = z.infer<typeof slaCreateSchema>;
export type SlaPatch = z.infer<typeof slaPatchSchema>;
export type SlaUpsert = z.infer<typeof slaUpsertSchema>;

/** The scalar columns a body sets, as Prisma data (the calendar is resolved by the caller). Absent keys stay untouched. */
export function slaData(b: Partial<SlaPatch>) {
  return {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.description !== undefined && { description: b.description || null }),
    ...(b.priority !== undefined && { priority: b.priority }),
    ...(b.response_mins !== undefined && { responseMins: b.response_mins }),
    ...(b.resolve_mins !== undefined && { resolveMins: b.resolve_mins }),
    ...(b.escalation_policy_id !== undefined && { escalationPolicyId: b.escalation_policy_id }),
    ...(b.is_active !== undefined && { isActive: b.is_active }),
    ...(b.import_ref !== undefined && { importRef: b.import_ref }),
  };
}

export type SlaRow = {
  id: string;
  name: string;
  description: string | null;
  priority: string | null;
  responseMins: number;
  resolveMins: number;
  isActive: boolean;
  businessCalendarId: string | null;
  escalationPolicyId: string | null;
  importRef: string | null;
  businessCalendar?: { id: string; name: string } | null;
};

/** The SLA as the API shows it (shared by the list, the detail and the write responses). */
export function serializeSla(s: SlaRow) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    priority: s.priority,
    response_mins: s.responseMins,
    resolve_mins: s.resolveMins,
    is_active: s.isActive,
    business_calendar_id: s.businessCalendarId,
    business_calendar: s.businessCalendar ? { id: s.businessCalendar.id, name: s.businessCalendar.name } : null,
    escalation_policy_id: s.escalationPolicyId,
    import_ref: s.importRef,
  };
}
