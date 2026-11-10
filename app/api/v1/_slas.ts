import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { apiError, ok } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { apiFieldNames, changedColumns } from "@/lib/api-record-diff";
import { serializeSla, slaData, type SlaPatch, type SlaRow } from "@/lib/api-sla-input";
import { importRefTaken, isUniqueOn } from "./_manage";

/** Shared plumbing of the /slas endpoints. */

export const SLA_WHAT = "SLAs";

export const SLA_SELECT = {
  id: true,
  name: true,
  description: true,
  priority: true,
  responseMins: true,
  resolveMins: true,
  isActive: true,
  businessCalendarId: true,
  escalationPolicyId: true,
  importRef: true,
  businessCalendar: { select: { id: true, name: true } },
} as const;

export function slaNotFound() {
  return apiError(404, "SLA not found");
}

function duplicateName(id?: string) {
  return apiError(409, "An SLA with that name already exists.", id ? { id } : undefined);
}

type Data = ReturnType<typeof slaData> & { businessCalendarId?: string | null };

/**
 * The Prisma data for a body on top of `current` (absent on create): 422 for an unknown calendar
 * (`business_calendar_id` / `business_calendar_ref`) or escalation policy; 409 for a name or
 * import_ref another SLA already has.
 */
export async function prepareSla(
  b: Partial<SlaPatch>,
  current: { id: string; name: string; importRef: string | null } | null,
): Promise<{ data: Data } | { response: ReturnType<typeof apiError> }> {
  const data: Data = slaData(b);
  if (b.business_calendar_id !== undefined || b.business_calendar_ref !== undefined) {
    if (b.business_calendar_id === null || b.business_calendar_ref === null) {
      data.businessCalendarId = null;
    } else {
      const calendar = await db.businessCalendar.findUnique({
        where: b.business_calendar_id !== undefined ? { id: b.business_calendar_id } : { importRef: b.business_calendar_ref! },
        select: { id: true },
      });
      if (!calendar) {
        const field = b.business_calendar_id !== undefined ? "business_calendar_id" : "business_calendar_ref";
        return { response: apiError(422, "Validation failed", { [field]: ["Business calendar not found."] }) };
      }
      data.businessCalendarId = calendar.id;
    }
  }
  if (data.escalationPolicyId) {
    const policy = await db.escalationPolicy.findUnique({ where: { id: data.escalationPolicyId }, select: { id: true } });
    if (!policy) return { response: apiError(422, "Validation failed", { escalation_policy_id: ["Escalation policy not found."] }) };
  }
  if (data.name && data.name !== current?.name) {
    const clash = await db.sLA.findUnique({ where: { name: data.name }, select: { id: true } });
    if (clash && clash.id !== current?.id) return { response: duplicateName(clash.id) };
  }
  if (data.importRef && data.importRef !== current?.importRef) {
    const taken = await db.sLA.findUnique({ where: { importRef: data.importRef }, select: { id: true } });
    if (taken && taken.id !== current?.id) return { response: importRefTaken(taken.id) };
  }
  return { data };
}

function touched() {
  revalidatePath("/settings/sla");
}

export async function createSlaRecord(data: Data & { name: string; responseMins: number; resolveMins: number }, actorId: string, via: string) {
  const sla = await db.sLA.create({ data, select: { id: true, name: true } });
  await writeAudit({ userId: actorId, action: "CREATE", entity: "SLA", entityId: sla.id, summary: `Created SLA "${sla.name}" via ${via}` });
  touched();
  return sla.id;
}

/** Writes the columns that differ from `current`; an unchanged body writes nothing and no audit row. */
export async function updateSlaRecord(current: SlaRow, data: Data, actorId: string, via: string) {
  const columns = changedColumns(current, data);
  const changed = apiFieldNames(columns);
  if (columns.length === 0) return { id: current.id, changed };
  const patch = Object.fromEntries(columns.map((k) => [k, data[k as keyof Data]]));
  const sla = await db.sLA.update({ where: { id: current.id }, data: patch, select: { id: true, name: true } });
  await writeAudit({
    userId: actorId, action: "UPDATE", entity: "SLA", entityId: sla.id,
    summary: `Updated SLA "${sla.name}" via ${via} (${changed.join(", ")})`, meta: { changed },
  });
  touched();
  return { id: sla.id, changed };
}

export async function slaResponse(id: string, init?: { status?: number; meta?: unknown }) {
  const sla = await db.sLA.findUnique({ where: { id }, select: SLA_SELECT });
  return sla ? ok(serializeSla(sla), init) : slaNotFound();
}

/** 409 for a unique value lost to a concurrent writer; otherwise rethrows. */
export function slaWriteConflict(err: unknown) {
  if (isUniqueOn(err, "importRef")) return importRefTaken();
  if (isUniqueOn(err, "name")) return duplicateName();
  throw err;
}
