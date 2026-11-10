import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { syncGeneratedHolidays } from "@/lib/holiday-sync";
import { agentGuard } from "../../../../_itsm";
import { managerOnly } from "../../../../_manage";
import { CALENDAR_WHAT } from "../../../../_calendars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * Remove a manual holiday (MANAGER+). A generated holiday cannot be removed one by one (409): it follows the
 * calendar's `holiday_region`, so clear the region to drop them all, or add a manual holiday on that date.
 * Removing a manual holiday on a date the region also names brings the generated one back.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; holidayId: string }> }) {
  const auth = await agentGuard(req, "sla:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, CALENDAR_WHAT);
  if (refused) return refused;
  const { id, holidayId } = await ctx.params;
  const holiday = await db.holiday.findFirst({
    where: { id: holidayId, calendarId: id },
    select: { id: true, name: true, date: true, generated: true, calendar: { select: { name: true } } },
  });
  if (!holiday) return apiError(404, "Holiday not found");
  if (holiday.generated) {
    return apiError(409, "This holiday is generated from the calendar's holiday_region and cannot be removed on its own.", {
      code: "HOLIDAY_GENERATED",
      hint: "Add a manual holiday on that date to override it, or set holiday_region to null to drop all generated holidays.",
    });
  }
  const res = await db.holiday.deleteMany({ where: { id: holidayId, calendarId: id, generated: false } });
  if (res.count > 0) {
    await syncGeneratedHolidays(id);
    await writeAudit({
      userId: auth.principal.userId, action: "UPDATE", entity: "BusinessCalendar", entityId: id,
      summary: `Removed holiday "${holiday.name}" (${holiday.date.toISOString().slice(0, 10)}) of "${holiday.calendar.name}" via API`,
    });
    revalidatePath("/settings/sla");
  }
  return ok({ id: holidayId, deleted: res.count > 0 });
}
