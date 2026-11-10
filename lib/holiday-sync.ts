import { db } from "@/lib/db";
import { generatedYears, planGeneratedHolidays, publicHolidays, type HolidayRow } from "@/lib/public-holidays";

/**
 * Keeps the generated public holidays of business calendars in step with their `holidayRegion`
 * (rules and dates: lib/public-holidays.ts). A generated holiday is an ordinary `Holiday` row with
 * `generated = true`, so the SLA clock (lib/sla.ts) needs no special case. A manual holiday on the
 * same date wins: the generated one is not kept.
 *
 * Run from the calendar editors (console and API), after every manual holiday change, and by the
 * scheduler (lib/ticks/holidays.ts), which rolls the window forward when a year turns.
 */

export type HolidaySyncResult = { created: number; removed: number; renamed: number };

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
export const dateOfDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

/**
 * Brings the generated holidays of one calendar to its region's rules for the current and the next
 * year. `reset` (the region changed or was switched off) also removes generated holidays of other
 * years, which belonged to the old region; otherwise earlier years are left as history.
 */
export async function syncGeneratedHolidays(
  calendarId: string,
  options: { now?: Date; reset?: boolean } = {},
): Promise<HolidaySyncResult> {
  const calendar = await db.businessCalendar.findUnique({
    where: { id: calendarId },
    select: { timezone: true, holidayRegion: true, holidays: { select: { id: true, date: true, name: true, generated: true } } },
  });
  const none = { created: 0, removed: 0, renamed: 0 };
  if (!calendar) return none;

  const years = generatedYears(options.now ?? new Date(), calendar.timezone);
  const desired = calendar.holidayRegion ? years.flatMap((year) => publicHolidays(calendar.holidayRegion!, year)) : [];
  const existing: HolidayRow[] = calendar.holidays.map((h) => ({ id: h.id, date: dayOf(h.date), name: h.name, generated: h.generated }));
  const plan = planGeneratedHolidays(existing, desired, years, options.reset === true || !calendar.holidayRegion);
  if (plan.create.length === 0 && plan.remove.length === 0 && plan.rename.length === 0) return none;

  await db.$transaction([
    ...(plan.remove.length ? [db.holiday.deleteMany({ where: { id: { in: plan.remove }, calendarId, generated: true } })] : []),
    ...plan.rename.map((r) => db.holiday.update({ where: { id: r.id }, data: { name: r.name } })),
    ...(plan.create.length
      ? [db.holiday.createMany({ data: plan.create.map((h) => ({ calendarId, date: dateOfDay(h.date), name: h.name, generated: true })) })]
      : []),
  ]);
  return { created: plan.create.length, removed: plan.remove.length, renamed: plan.rename.length };
}

/** Syncs every calendar that has a region (the scheduler's sweep). */
export async function syncAllGeneratedHolidays(now = new Date()): Promise<HolidaySyncResult & { calendars: number }> {
  const calendars = await db.businessCalendar.findMany({ where: { holidayRegion: { not: null } }, select: { id: true } });
  const total = { created: 0, removed: 0, renamed: 0, calendars: calendars.length };
  for (const { id } of calendars) {
    try {
      const r = await syncGeneratedHolidays(id, { now });
      total.created += r.created;
      total.removed += r.removed;
      total.renamed += r.renamed;
    } catch (e) {
      // One calendar must not stop the others.
      console.error(`[servio:holidays] calendar ${id}:`, e instanceof Error ? e.message : e);
    }
  }
  return total;
}
