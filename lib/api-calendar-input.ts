import { z } from "zod";
import { WEEKDAY_KEYS } from "@/lib/business-hours";
import { HOLIDAY_REGIONS } from "@/lib/public-holidays";
import { EXTERNAL_REF_HINT, EXTERNAL_REF_RE } from "@/lib/ticket-external-ref";

/**
 * Request bodies of the business-calendar endpoints (/api/v1/business-calendars, snake_case and
 * strict: an unknown field is a 422). Pure and DB-free, so the contract is unit-testable; shared
 * with the OpenAPI route and the holiday sync.
 */
const ref = z.string().regex(EXTERNAL_REF_RE, EXTERNAL_REF_HINT);

const HHMM = /^(?:[01]?\d|2[0-3]):[0-5]\d$|^24:00$/;
const HHMM_HINT = "Use HH:MM (24:00 ends the day)";
const minutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** One open window of a day: `["09:00", "17:00"]`, wall-clock in the calendar's timezone. */
const windowSchema = z
  .tuple([z.string().regex(HHMM, HHMM_HINT), z.string().regex(HHMM, HHMM_HINT)])
  .refine(([open, close]) => minutes(close) > minutes(open), { message: "A window must close after it opens" });

/** Open windows per weekday (`sun`..`sat`); a day that is left out or `[]` is closed. */
export const weeklyHoursSchema = z.strictObject(
  Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, z.array(windowSchema).max(8).optional()])),
);

/** A real calendar day as `YYYY-MM-DD`. */
export const isoDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getUTCFullYear() >= 1970 && d.getUTCFullYear() <= 2200;
  }, "Not a calendar day");

/** A manual (non-generated) holiday. */
export const holidayInputSchema = z.strictObject({
  date: isoDaySchema,
  name: z.string().trim().min(1).max(120),
});
export type HolidayInput = z.infer<typeof holidayInputSchema>;

/** An IANA timezone name the runtime knows; anything else would silently count as UTC. */
export function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const MAX_HOLIDAYS = 400;

const calendarFields = {
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  timezone: z.string().trim().min(1).max(64).refine(isValidTimezone, "Not a known IANA timezone, e.g. Europe/Berlin"),
  weekly_hours: weeklyHoursSchema,
  /** Region whose public holidays are generated for this and the next year (e.g. `DE-BE`); null switches the generation off. */
  holiday_region: z.enum(HOLIDAY_REGIONS).nullable(),
  /** The manual holidays. Replaces the whole manual set (generated ones are not touched); [] removes all manual holidays. */
  holidays: z
    .array(holidayInputSchema)
    .max(MAX_HOLIDAYS)
    .refine((list) => new Set(list.map((h) => h.date)).size === list.length, "A date can appear only once"),
};

const optionalFields = Object.fromEntries(Object.entries(calendarFields).map(([k, s]) => [k, s.optional()])) as {
  [K in keyof typeof calendarFields]: z.ZodOptional<(typeof calendarFields)[K]>;
};

export const calendarCreateSchema = z.strictObject({
  ...optionalFields,
  name: calendarFields.name,
  /** Required: a calendar without open windows would never be open, which no integration means. */
  weekly_hours: calendarFields.weekly_hours,
  /** Origin key for later upserts through PUT /business-calendars/ref/{ref}. */
  import_ref: ref.optional(),
});

export const calendarPatchSchema = z
  .strictObject({
    ...optionalFields,
    /** Adopts an existing calendar into the reference scheme; null releases the reference. */
    import_ref: ref.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

/** Body of PUT /business-calendars/ref/{ref}: `name` and `weekly_hours` are required when the reference is new. */
export const calendarUpsertSchema = z
  .strictObject(optionalFields)
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to write" });

export type CalendarCreate = z.infer<typeof calendarCreateSchema>;
export type CalendarPatch = z.infer<typeof calendarPatchSchema>;
export type CalendarUpsert = z.infer<typeof calendarUpsertSchema>;

/**
 * The stored form of the weekly hours: every weekday present (closed = `[]`), windows sorted by opening
 * time. Two bodies that mean the same hours compare equal as strings.
 */
export function canonicalWeeklyHours(hours: Record<string, unknown> | undefined | null): string {
  const out: Record<string, string[][]> = {};
  for (const key of WEEKDAY_KEYS) {
    const day = hours?.[key];
    out[key] = Array.isArray(day)
      ? (day as unknown[])
          .filter((w): w is [string, string] => Array.isArray(w) && w.length >= 2)
          .map((w) => [String(w[0]), String(w[1])])
          .sort((a, b) => a[0].localeCompare(b[0]))
      : [];
  }
  return JSON.stringify(out);
}

/** The stored weeklyHours JSON as an object (an unreadable value counts as no open hours). */
export function parseStoredWeeklyHours(json: string): Record<string, string[][]> {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    raw = {};
  }
  return JSON.parse(canonicalWeeklyHours(raw));
}

/** The scalar columns a body sets, as Prisma data. Absent keys stay untouched. */
export function calendarData(b: Partial<CalendarPatch>) {
  return {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.timezone !== undefined && { timezone: b.timezone }),
    ...(b.weekly_hours !== undefined && { weeklyHours: canonicalWeeklyHours(b.weekly_hours) }),
    ...(b.holiday_region !== undefined && { holidayRegion: b.holiday_region }),
    ...(b.import_ref !== undefined && { importRef: b.import_ref }),
  };
}

export type CalendarRow = {
  id: string;
  name: string;
  timezone: string;
  weeklyHours: string;
  holidayRegion: string | null;
  importRef: string | null;
  holidays?: { id: string; date: Date; name: string; generated: boolean }[];
  _count?: { slas: number };
};

export function serializeHoliday(h: { id: string; date: Date; name: string; generated: boolean }) {
  return { id: h.id, date: h.date.toISOString().slice(0, 10), name: h.name, generated: h.generated };
}

/** The calendar as the API shows it; holidays are sorted by date, generated ones marked. */
export function serializeCalendar(c: CalendarRow) {
  return {
    id: c.id,
    name: c.name,
    timezone: c.timezone,
    weekly_hours: parseStoredWeeklyHours(c.weeklyHours),
    holiday_region: c.holidayRegion,
    holidays: [...(c.holidays ?? [])].sort((a, b) => a.date.getTime() - b.date.getTime()).map(serializeHoliday),
    sla_count: c._count?.slas ?? null,
    import_ref: c.importRef,
  };
}
