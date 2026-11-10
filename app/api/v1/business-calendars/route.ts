import { db } from "@/lib/db";
import { ok, preflight } from "@/lib/api";
import { calendarCreateSchema, serializeCalendar } from "@/lib/api-calendar-input";
import { agentGuard, readBody } from "../_itsm";
import { managerOnly } from "../_manage";
import { CALENDAR_SELECT, CALENDAR_WHAT, calendarResponse, calendarWriteConflict, createCalendarRecord, prepareCalendar } from "../_calendars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Business calendars with their working hours and holidays (manual and generated, marked `generated`). Filter: `import_ref`. Agent tokens only. */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "sla:read");
  if ("response" in auth) return auth.response;
  const importRef = new URL(req.url).searchParams.get("import_ref");
  const rows = await db.businessCalendar.findMany({
    where: importRef ? { importRef } : {},
    orderBy: { name: "asc" },
    select: CALENDAR_SELECT,
  });
  return ok(rows.map(serializeCalendar));
}

/**
 * Create a business calendar (MANAGER+, like the console). `weekly_hours` gives the open windows per weekday
 * (`mon`..`sun`, wall-clock in `timezone`), `holidays` the manual holidays, and `holiday_region` (e.g.
 * `DE-BE`) switches on the generated public holidays for this and the next year.
 */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "sla:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, CALENDAR_WHAT);
  if (refused) return refused;
  const body = await readBody(req, calendarCreateSchema);
  if ("response" in body) return body.response;
  const prepared = await prepareCalendar(body.data, null);
  if ("response" in prepared) return prepared.response;
  try {
    const id = await createCalendarRecord({ ...prepared.data, name: body.data.name }, body.data.holidays, auth.principal.userId, "API");
    return calendarResponse(id, { status: 201 });
  } catch (err) {
    return calendarWriteConflict(err);
  }
}
