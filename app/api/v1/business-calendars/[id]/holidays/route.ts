import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { holidayInputSchema, serializeHoliday } from "@/lib/api-calendar-input";
import { dateOfDay, syncGeneratedHolidays } from "@/lib/holiday-sync";
import { agentGuard, readBody } from "../../../_itsm";
import { managerOnly } from "../../../_manage";
import { CALENDAR_WHAT, calendarNotFound } from "../../../_calendars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * Add a manual holiday (MANAGER+). Idempotent per date: a manual holiday already on that date only gets the
 * new name (200, `meta.created` false), otherwise it is created (201). A manual holiday wins over a
 * generated one on the same date, which is dropped.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "sla:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, CALENDAR_WHAT);
  if (refused) return refused;
  const { id } = await ctx.params;
  const calendar = await db.businessCalendar.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!calendar) return calendarNotFound();
  const body = await readBody(req, holidayInputSchema);
  if ("response" in body) return body.response;

  const date = dateOfDay(body.data.date);
  const existing = await db.holiday.findFirst({ where: { calendarId: id, date, generated: false }, select: { id: true, name: true } });
  let holidayId: string;
  if (existing) {
    holidayId = existing.id;
    if (existing.name !== body.data.name) await db.holiday.update({ where: { id: existing.id }, data: { name: body.data.name } });
  } else {
    holidayId = (await db.holiday.create({ data: { calendarId: id, date, name: body.data.name }, select: { id: true } })).id;
  }
  const changed = !existing || existing.name !== body.data.name;
  if (changed) {
    await syncGeneratedHolidays(id);
    await writeAudit({
      userId: auth.principal.userId, action: "UPDATE", entity: "BusinessCalendar", entityId: id,
      summary: `${existing ? "Renamed" : "Added"} holiday "${body.data.name}" (${body.data.date}) of "${calendar.name}" via API`,
    });
    revalidatePath("/settings/sla");
  }
  const holiday = await db.holiday.findUniqueOrThrow({ where: { id: holidayId } });
  return ok(serializeHoliday(holiday), { status: existing ? 200 : 201, meta: { created: !existing, changed } });
}
