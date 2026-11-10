import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { calendarPatchSchema } from "@/lib/api-calendar-input";
import { calendarReferences } from "@/lib/sla-references";
import { calendarInUseRefusal } from "@/lib/sla-rules";
import { agentGuard, readBody } from "../../_itsm";
import { managerOnly } from "../../_manage";
import {
  CALENDAR_SELECT, CALENDAR_WHAT, calendarNotFound, calendarResponse, calendarWriteConflict, prepareCalendar, updateCalendarRecord,
} from "../../_calendars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** One business calendar with its holidays. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "sla:read");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  return calendarResponse(id);
}

/**
 * Update a business calendar (MANAGER+). Only the fields sent change. `holidays` replaces the manual
 * holidays (generated ones are not touched); `holiday_region` regenerates the public holidays, `null`
 * removes the generated ones. `meta.changed` lists what changed.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "sla:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, CALENDAR_WHAT);
  if (refused) return refused;
  const { id } = await ctx.params;
  const current = await db.businessCalendar.findUnique({ where: { id }, select: CALENDAR_SELECT });
  if (!current) return calendarNotFound();
  const body = await readBody(req, calendarPatchSchema);
  if ("response" in body) return body.response;
  const prepared = await prepareCalendar(body.data, current);
  if ("response" in prepared) return prepared.response;
  try {
    const { changed } = await updateCalendarRecord(current, prepared.data, body.data.holidays, auth.principal.userId, "API");
    return calendarResponse(id, { meta: { changed } });
  } catch (err) {
    return calendarWriteConflict(err);
  }
}

/**
 * Delete a business calendar (MANAGER+). Refused with 409 while SLAs still use it: `details.references`
 * counts them and `details.hint` says what to do. Its holidays go with it.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "sla:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, CALENDAR_WHAT);
  if (refused) return refused;
  const { id } = await ctx.params;
  const calendar = await db.businessCalendar.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!calendar) return calendarNotFound();
  const inUse = calendarInUseRefusal(await calendarReferences(id));
  if (inUse) {
    const { message, ...details } = inUse;
    return apiError(409, message, details);
  }
  // deleteMany: a concurrent delete of the same calendar is not an error, and only a real deletion is audited.
  const res = await db.businessCalendar.deleteMany({ where: { id } });
  if (res.count > 0) {
    await writeAudit({ userId: auth.principal.userId, action: "DELETE", entity: "BusinessCalendar", entityId: id, summary: `Deleted business calendar "${calendar.name}" via API` });
    revalidatePath("/settings/sla");
  }
  return ok({ id, deleted: res.count > 0 });
}
