import { db } from "@/lib/db";
import { nonEmptyReferences } from "@/lib/sla-rules";

/** What still points at an SLA (see lib/sla-rules.ts for why). Kinds with nothing are left out. */
export async function slaReferences(id: string) {
  const [tickets, services] = await Promise.all([
    db.ticket.count({ where: { slaId: id } }),
    db.service.count({ where: { slaId: id } }),
  ]);
  return nonEmptyReferences({ tickets, services });
}

/** What still points at a business calendar. Its holidays are not references: they go with it. */
export async function calendarReferences(id: string) {
  return nonEmptyReferences({ slas: await db.sLA.count({ where: { businessCalendarId: id } }) });
}
