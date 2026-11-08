/**
 * Input contract of recurring tickets: the console form (FormData strings) and
 * the /api/v1/recurring-tickets bodies (strict snake_case JSON), plus the
 * translation of an API body into the form the console actions take. Pure and
 * DB-free, so it is unit-tested; the REST handlers run the actions as the token
 * owner (lib/api-actor.ts), so the console rules apply to the API unchanged.
 */
import { z } from "zod";
import {
  IMPACT_URGENCY,
  PRIORITIES,
  RECURRENCE_FREQUENCIES,
  TICKET_TYPES,
  type RecurrenceFrequency,
} from "@/lib/constants";
import { formOf } from "@/lib/api-itsm-input";
import { isValidTimeZone, parseZonedDateTime } from "@/lib/oncall-rules";
import {
  MAX_CREATE_BEFORE_DAYS,
  MAX_RECURRENCE_INTERVAL,
  leadTimeError,
  localDateTimeParts,
  type Recurrence,
} from "@/lib/recurring-ticket-rules";

// ── Console form ─────────────────────────────────────────────────────────────

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" ? v : null));

const wholeNumber = (label: string, min: number, max: number, fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? Number(v) : fallback))
    .pipe(
      z
        .number({ error: `${label} must be a number` })
        .int(`${label} must be a whole number`)
        .min(min, `${label} must be at least ${min}`)
        .max(max, `${label} must be at most ${max}`),
    );

const formSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120, "Name must be at most 120 characters"),
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(250, "Title must be at most 250 characters"),
  description: z.string().max(20_000, "Description is too long").optional().default(""),
  type: z.enum(TICKET_TYPES, { error: "Choose a ticket type" }),
  priority: z.enum(PRIORITIES, { error: "Choose a priority" }),
  impact: z.enum(IMPACT_URGENCY, { error: "Choose an impact" }),
  urgency: z.enum(IMPACT_URGENCY, { error: "Choose an urgency" }),
  requesterId: optionalId,
  assigneeId: optionalId,
  groupId: optionalId,
  categoryId: optionalId,
  serviceId: optionalId,
  frequency: z.enum(RECURRENCE_FREQUENCIES, { error: "Choose how often it recurs" }),
  interval: wholeNumber("Interval", 1, MAX_RECURRENCE_INTERVAL, 1),
  timezone: z.string().refine(isValidTimeZone, "Unknown time zone (use an IANA name like Europe/Berlin)"),
  /** "YYYY-MM-DDTHH:mm" wall-clock time in `timezone`, or an ISO time with offset. */
  firstDueAt: z.string().min(1, "Choose the first due date"),
  createBeforeDays: wholeNumber("Lead time", 0, MAX_CREATE_BEFORE_DAYS, 0),
  isActive: z
    .string()
    .optional()
    .transform((v) => v !== "false" && v !== "off"),
  /** API only: origin key of an imported schedule. */
  importRef: z
    .string()
    .optional()
    .transform((v) => v?.trim() || null),
  /** API only (history import): due instant of the last occurrence the source system already created. */
  lastCreatedFor: z
    .string()
    .optional()
    .transform((v) => v?.trim() || null),
});

export type RecurringTicketForm = Omit<z.infer<typeof formSchema>, "firstDueAt" | "lastCreatedFor"> & {
  firstDueAt: Date;
  lastCreatedFor: Date | null;
};

export type FormParse =
  | { success: true; data: RecurringTicketForm }
  | { success: false; error: string; fieldErrors: Record<string, string[]> };

/** The due time is kept at minute resolution, like the form inputs. */
const toMinute = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000);

/** Validate the console form (also what the REST bodies are translated into). */
export function parseRecurringTicketForm(formData: FormData): FormParse {
  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) if (typeof value === "string") raw[key] = value;
  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  }
  const d = parsed.data;
  const fieldErrors: Record<string, string[]> = {};
  const firstDueAt = parseZonedDateTime(d.firstDueAt, d.timezone);
  if (Number.isNaN(firstDueAt.getTime())) fieldErrors.firstDueAt = ["Enter the first due date and time"];
  const lastCreatedFor = d.lastCreatedFor ? new Date(d.lastCreatedFor) : null;
  if (lastCreatedFor && Number.isNaN(lastCreatedFor.getTime())) fieldErrors.lastCreatedFor = ["Not a valid date and time"];
  const lead = leadTimeError(d.frequency, d.interval, d.createBeforeDays);
  if (lead) fieldErrors.createBeforeDays = [lead];
  if (d.importRef && d.importRef.length > 200) fieldErrors.importRef = ["At most 200 characters"];
  if (Object.keys(fieldErrors).length) return { success: false, error: "Please fix the errors below.", fieldErrors };
  return { success: true, data: { ...d, firstDueAt: toMinute(firstDueAt), lastCreatedFor } };
}

/** The recurrence fields; a change to any of them recomputes `nextDueAt`. */
export function recurrenceChanged(
  before: { frequency: string; interval: number; timezone: string; firstDueAt: Date; createBeforeDays: number },
  after: { frequency: string; interval: number; timezone: string; firstDueAt: Date; createBeforeDays: number },
): boolean {
  return (
    before.frequency !== after.frequency ||
    before.interval !== after.interval ||
    before.timezone !== after.timezone ||
    before.firstDueAt.getTime() !== after.firstDueAt.getTime() ||
    before.createBeforeDays !== after.createBeforeDays
  );
}

// ── REST bodies ──────────────────────────────────────────────────────────────

const id = z.string().min(1);
/** "2026-12-01T09:00" (wall-clock time in `timezone`) or an ISO time with offset ("2026-12-01T08:00:00Z"). */
const dueTime = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:mm or an ISO time with offset"),
  z.iso.datetime({ offset: true }),
]);

const templateFields = {
  name: z.string().trim().min(2).max(120),
  title: z.string().trim().min(3).max(250),
  description: z.string().max(20_000),
  type: z.enum(TICKET_TYPES),
  priority: z.enum(PRIORITIES),
  impact: z.enum(IMPACT_URGENCY),
  urgency: z.enum(IMPACT_URGENCY),
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  interval: z.number().int().min(1).max(MAX_RECURRENCE_INTERVAL),
  timezone: z.string().refine(isValidTimeZone, "Unknown IANA time zone"),
  first_due_at: dueTime,
  create_before_days: z.number().int().min(0).max(MAX_CREATE_BEFORE_DAYS),
  active: z.boolean(),
};

export const recurringTicketCreateSchema = z.strictObject({
  name: templateFields.name,
  title: templateFields.title,
  description: templateFields.description.optional(),
  type: templateFields.type.optional().default("REQUEST"),
  priority: templateFields.priority.optional().default("MEDIUM"),
  impact: templateFields.impact.optional().default("MEDIUM"),
  urgency: templateFields.urgency.optional().default("MEDIUM"),
  /** Defaults to the token owner. */
  requester_id: id.optional(),
  assignee_id: id.optional(),
  group_id: id.optional(),
  category_id: id.optional(),
  service_id: id.optional(),
  frequency: templateFields.frequency,
  interval: templateFields.interval.optional().default(1),
  timezone: templateFields.timezone.optional().default("UTC"),
  first_due_at: templateFields.first_due_at,
  create_before_days: templateFields.create_before_days.optional().default(0),
  active: templateFields.active.optional().default(true),
  /** Origin of an imported schedule (e.g. "glpi:ticketrecurrent:7"); a re-run with the same ref is a no-op (200). */
  import_ref: z.string().trim().min(1).max(200).optional(),
  /** History import: due time of the last occurrence the source system already created a ticket for. */
  last_created_for: z.iso.datetime({ offset: true }).optional(),
});

export const recurringTicketPatchSchema = z
  .strictObject({
    name: templateFields.name.optional(),
    title: templateFields.title.optional(),
    description: templateFields.description.optional(),
    type: templateFields.type.optional(),
    priority: templateFields.priority.optional(),
    impact: templateFields.impact.optional(),
    urgency: templateFields.urgency.optional(),
    /** `null` = the schedule's creator. */
    requester_id: id.nullable().optional(),
    assignee_id: id.nullable().optional(),
    group_id: id.nullable().optional(),
    category_id: id.nullable().optional(),
    service_id: id.nullable().optional(),
    frequency: templateFields.frequency.optional(),
    interval: templateFields.interval.optional(),
    timezone: templateFields.timezone.optional(),
    first_due_at: templateFields.first_due_at.optional(),
    create_before_days: templateFields.create_before_days.optional(),
    /** false pauses the schedule, true resumes it (from the next occurrence that is not due yet). */
    active: templateFields.active.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

export type RecurringTicketCreateBody = z.infer<typeof recurringTicketCreateSchema>;
export type RecurringTicketPatchBody = z.infer<typeof recurringTicketPatchSchema>;

/** The console form of a create body. `fallbackRequesterId` is the token owner. */
export function recurringTicketCreateForm(b: RecurringTicketCreateBody, fallbackRequesterId: string): FormData {
  return formOf({
    name: b.name,
    title: b.title,
    description: b.description ?? "",
    type: b.type,
    priority: b.priority,
    impact: b.impact,
    urgency: b.urgency,
    requesterId: b.requester_id ?? fallbackRequesterId,
    assigneeId: b.assignee_id,
    groupId: b.group_id,
    categoryId: b.category_id,
    serviceId: b.service_id,
    frequency: b.frequency,
    interval: b.interval,
    timezone: b.timezone,
    firstDueAt: b.first_due_at,
    createBeforeDays: b.create_before_days,
    isActive: String(b.active),
    importRef: b.import_ref,
    lastCreatedFor: b.last_created_for,
  });
}

/** The stored schedule, as far as the patch merge needs it. */
export type RecurringTicketRow = {
  id: string;
  name: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  impact: string;
  urgency: string;
  requesterId: string | null;
  assigneeId: string | null;
  groupId: string | null;
  categoryId: string | null;
  serviceId: string | null;
  frequency: string;
  interval: number;
  timezone: string;
  firstDueAt: Date;
  createBeforeDays: number;
  isActive: boolean;
};

/**
 * The console form of a PATCH: fields the body leaves out keep their stored
 * value. When only the time zone changes, the first due date keeps its
 * wall-clock time and is read in the new zone (like the console form).
 */
export function recurringTicketPatchForm(current: RecurringTicketRow, b: RecurringTicketPatchBody): FormData {
  const pick = <K extends keyof RecurringTicketPatchBody>(key: K, fallback: string | number | null) =>
    key in b ? (b[key] as string | number | null) : fallback;
  const local = localDateTimeParts(current.firstDueAt, current.timezone);
  return formOf({
    id: current.id,
    name: pick("name", current.name),
    title: pick("title", current.title),
    description: pick("description", current.description),
    type: pick("type", current.type),
    priority: pick("priority", current.priority),
    impact: pick("impact", current.impact),
    urgency: pick("urgency", current.urgency),
    requesterId: pick("requester_id", current.requesterId),
    assigneeId: pick("assignee_id", current.assigneeId),
    groupId: pick("group_id", current.groupId),
    categoryId: pick("category_id", current.categoryId),
    serviceId: pick("service_id", current.serviceId),
    frequency: pick("frequency", current.frequency),
    interval: pick("interval", current.interval),
    timezone: pick("timezone", current.timezone),
    firstDueAt: pick("first_due_at", `${local.date}T${local.time}`),
    createBeforeDays: pick("create_before_days", current.createBeforeDays),
    isActive: String("active" in b ? b.active : current.isActive),
  });
}

/** Typed frequency of a stored row (falls back to MONTHLY for unknown data). */
export function frequencyOf(value: string): RecurrenceFrequency {
  return (RECURRENCE_FREQUENCIES as readonly string[]).includes(value) ? (value as RecurrenceFrequency) : "MONTHLY";
}

/** The recurrence of a stored row, clamped to sane values. */
export function recurrenceOf(row: { frequency: string; interval: number; timezone: string; firstDueAt: Date; createBeforeDays: number }): Recurrence {
  return {
    frequency: frequencyOf(row.frequency),
    interval: Math.max(1, row.interval),
    timezone: row.timezone,
    firstDueAt: row.firstDueAt,
    createBeforeDays: Math.max(0, row.createBeforeDays),
  };
}
