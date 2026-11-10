import { db } from "@/lib/db";
import { apiError, preflight, type ApiPrincipal } from "@/lib/api";
import { calendarUpsertSchema, type CalendarUpsert } from "@/lib/api-calendar-input";
import { agentGuard, readBody } from "../../../_itsm";
import { invalidRef, isUniqueOn, managerOnly, refOf } from "../../../_manage";
import {
  CALENDAR_SELECT, CALENDAR_WHAT, calendarNotFound, calendarResponse, calendarWriteConflict, createCalendarRecord, prepareCalendar,
  updateCalendarRecord,
} from "../../../_calendars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** The business calendar with this origin reference (e.g. `hr:calendar:office`), or 404. */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "sla:read");
  if ("response" in auth) return auth.response;
  const ref = await refOf(ctx);
  const row = ref ? await db.businessCalendar.findUnique({ where: { importRef: ref }, select: { id: true } }) : null;
  if (!row) return calendarNotFound();
  return calendarResponse(row.id);
}

/**
 * Upsert by origin reference (MANAGER+), for keeping calendars in step with a source. Creates the calendar
 * (201; `name` and `weekly_hours` required) when the reference is new, otherwise writes only the fields sent (200). Re-sending
 * the same facts writes nothing and no audit row; `meta.changed` lists what changed. Sending `holidays`
 * replaces the manual holidays, so a yearly list can be pushed as it is.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "sla:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, CALENDAR_WHAT);
  if (refused) return refused;
  const ref = await refOf(ctx);
  if (!ref) return invalidRef();
  const body = await readBody(req, calendarUpsertSchema);
  if ("response" in body) return body.response;

  try {
    return await upsert(auth.principal, ref, body.data);
  } catch (err) {
    // Two runs creating the same ref at once: the loser retries as an update.
    if (isUniqueOn(err, "importRef")) return upsert(auth.principal, ref, body.data).catch(calendarWriteConflict);
    return calendarWriteConflict(err);
  }
}

async function upsert(principal: ApiPrincipal, ref: string, b: CalendarUpsert) {
  const current = await db.businessCalendar.findUnique({ where: { importRef: ref }, select: CALENDAR_SELECT });
  if (!current) {
    const missing = Object.fromEntries(
      (["name", "weekly_hours"] as const).filter((k) => b[k] === undefined).map((k) => [k, ["Required to create a new business calendar"]]),
    );
    if (Object.keys(missing).length) return apiError(422, "Validation failed", missing);
  }
  const prepared = await prepareCalendar(b, current);
  if ("response" in prepared) return prepared.response;
  const via = `API (${ref})`;
  if (!current) {
    const id = await createCalendarRecord({ ...prepared.data, name: b.name!, importRef: ref }, b.holidays, principal.userId, via);
    return calendarResponse(id, { status: 201, meta: { created: true, changed: Object.keys(b) } });
  }
  const { id, changed } = await updateCalendarRecord(current, prepared.data, b.holidays, principal.userId, via);
  return calendarResponse(id, { meta: { created: false, changed } });
}
