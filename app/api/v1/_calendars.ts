import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { apiError, ok } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { apiFieldNames, changedColumns } from "@/lib/api-record-diff";
import {
  calendarData, canonicalWeeklyHours, serializeCalendar, type CalendarPatch, type HolidayInput,
} from "@/lib/api-calendar-input";
import { dateOfDay, syncGeneratedHolidays } from "@/lib/holiday-sync";
import { planManualHolidays } from "@/lib/public-holidays";
import { importRefTaken, isUniqueOn } from "./_manage";

/** Shared plumbing of the /business-calendars endpoints. */

export const CALENDAR_WHAT = "business calendars";

export const CALENDAR_SELECT = {
  id: true,
  name: true,
  timezone: true,
  weeklyHours: true,
  holidayRegion: true,
  importRef: true,
  holidays: { select: { id: true, date: true, name: true, generated: true }, orderBy: { date: "asc" } },
  _count: { select: { slas: true } },
} as const;

type Current = {
  id: string;
  name: string;
  timezone: string;
  weeklyHours: string;
  holidayRegion: string | null;
  importRef: string | null;
  holidays: { id: string; date: Date; name: string; generated: boolean }[];
};
type Data = ReturnType<typeof calendarData>;

export function calendarNotFound() {
  return apiError(404, "Business calendar not found");
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** 422/409 for a body that cannot be written on top of `current` (absent on create); otherwise the Prisma data. */
export async function prepareCalendar(
  b: Partial<CalendarPatch>,
  current: { id: string; importRef: string | null } | null,
): Promise<{ data: Data } | { response: ReturnType<typeof apiError> }> {
  const data = calendarData(b);
  if (data.importRef && data.importRef !== current?.importRef) {
    const taken = await db.businessCalendar.findUnique({ where: { importRef: data.importRef }, select: { id: true } });
    if (taken && taken.id !== current?.id) return { response: importRefTaken(taken.id) };
  }
  return { data };
}

export async function calendarDetail(id: string) {
  const calendar = await db.businessCalendar.findUnique({ where: { id }, select: CALENDAR_SELECT });
  return calendar ? serializeCalendar(calendar) : null;
}

export async function calendarResponse(id: string, init?: { status?: number; meta?: unknown }) {
  const detail = await calendarDetail(id);
  return detail ? ok(detail, init) : calendarNotFound();
}

function touched() {
  revalidatePath("/settings/sla");
}

export async function createCalendarRecord(
  data: Data & { name: string },
  holidays: HolidayInput[] | undefined,
  actorId: string,
  via: string,
) {
  const calendar = await db.businessCalendar.create({
    data: {
      ...data,
      ...(holidays?.length && { holidays: { create: holidays.map((h) => ({ date: dateOfDay(h.date), name: h.name })) } }),
    },
    select: { id: true, name: true },
  });
  await syncGeneratedHolidays(calendar.id, { reset: true });
  await writeAudit({ userId: actorId, action: "CREATE", entity: "BusinessCalendar", entityId: calendar.id, summary: `Created business calendar "${calendar.name}" via ${via}` });
  touched();
  return calendar.id;
}

/**
 * Writes the columns that differ from `current`, brings the manual holidays to `holidays` (when sent) and
 * regenerates the public holidays when the region or the manual holidays changed. An unchanged body writes
 * nothing and no audit row.
 */
export async function updateCalendarRecord(current: Current, data: Data, holidays: HolidayInput[] | undefined, actorId: string, via: string) {
  // The stored hours may be written in another shape (the console omits nothing, an import may); compare what they mean.
  const comparable = { ...current, weeklyHours: canonicalWeeklyHours(safeJson(current.weeklyHours)) };
  const columns = changedColumns(comparable, data);
  const manual = current.holidays.filter((h) => !h.generated).map((h) => ({ id: h.id, date: dayOf(h.date), name: h.name }));
  const plan = holidays ? planManualHolidays(manual, holidays) : null;
  const holidaysChanged = !!plan && (plan.create.length > 0 || plan.remove.length > 0 || plan.rename.length > 0);
  const changed = [...apiFieldNames(columns), ...(holidaysChanged ? ["holidays"] : [])];
  if (changed.length === 0) return { id: current.id, name: current.name, changed };

  const patch = Object.fromEntries(columns.map((k) => [k, data[k as keyof Data]]));
  const calendar = await db.$transaction(async (tx) => {
    if (plan?.remove.length) await tx.holiday.deleteMany({ where: { id: { in: plan.remove }, calendarId: current.id, generated: false } });
    for (const r of plan?.rename ?? []) await tx.holiday.update({ where: { id: r.id }, data: { name: r.name } });
    if (plan?.create.length) {
      await tx.holiday.createMany({ data: plan.create.map((h) => ({ calendarId: current.id, date: dateOfDay(h.date), name: h.name, generated: false })) });
    }
    return tx.businessCalendar.update({ where: { id: current.id }, data: patch, select: { id: true, name: true } });
  });
  // A new region replaces the old region's holidays; a manual holiday may override (or release) a generated one.
  await syncGeneratedHolidays(current.id, { reset: columns.includes("holidayRegion") });
  await writeAudit({
    userId: actorId, action: "UPDATE", entity: "BusinessCalendar", entityId: calendar.id,
    summary: `Updated business calendar "${calendar.name}" via ${via} (${changed.join(", ")})`, meta: { changed },
  });
  touched();
  return { id: calendar.id, name: calendar.name, changed };
}

function safeJson(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 409 for an import_ref lost to a concurrent writer; otherwise rethrows. */
export function calendarWriteConflict(err: unknown) {
  if (isUniqueOn(err, "importRef")) return importRefTaken();
  throw err;
}
