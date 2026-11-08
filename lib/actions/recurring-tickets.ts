"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireManagerUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { parseRecurringTicketForm, recurrenceChanged, recurrenceOf, type RecurringTicketForm } from "@/lib/recurring-ticket-input";
import { describeRecurrence, initialNextDue } from "@/lib/recurring-ticket-rules";
import { fireRecurringTicket } from "@/lib/recurring-tickets";

/**
 * Recurring tickets (Settings › Recurring tickets, MANAGER+). The REST API
 * (/api/v1/recurring-tickets) runs these same actions as the token owner.
 * Validation lives in lib/recurring-ticket-input.ts, the recurrence math in
 * lib/recurring-ticket-rules.ts, ticket creation in lib/recurring-tickets.ts.
 */

export type RecurringTicketState =
  | { ok: boolean; error?: string; fieldErrors?: Record<string, string[]>; id?: string }
  | undefined;

export type RecurringRunResult = { ok: boolean; error?: string; ticketId?: number; ref?: string };

const NOT_AUTHORISED = "Not authorised: only managers can manage recurring tickets.";
const NOT_FOUND = "Recurring ticket not found.";
const PATH = "/settings/recurring-tickets";

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** The people, team, category and service a template points at must exist (and be usable) before it is stored. */
async function referenceError(d: RecurringTicketForm): Promise<string | null> {
  const [requester, assignee, group, category, service] = await Promise.all([
    d.requesterId ? db.user.findUnique({ where: { id: d.requesterId }, select: { isActive: true } }) : true,
    d.assigneeId ? db.user.findUnique({ where: { id: d.assigneeId }, select: { isActive: true, role: true } }) : true,
    d.groupId ? db.group.findUnique({ where: { id: d.groupId }, select: { id: true } }) : true,
    d.categoryId ? db.category.findUnique({ where: { id: d.categoryId }, select: { id: true } }) : true,
    d.serviceId ? db.service.findUnique({ where: { id: d.serviceId }, select: { id: true } }) : true,
  ]);
  // "isn't valid" maps to 422 on the REST API (lib/api-itsm-input.ts refusalStatus).
  if (!requester || (requester !== true && !requester.isActive)) return "The requester isn't valid: choose an active user.";
  if (!assignee || (assignee !== true && (!assignee.isActive || assignee.role === "USER"))) {
    return "The assignee isn't valid: choose an active agent.";
  }
  if (!group) return "The group isn't valid: it no longer exists.";
  if (!category) return "The category isn't valid: it no longer exists.";
  if (!service) return "The service isn't valid: it no longer exists.";
  return null;
}

function templateColumns(d: RecurringTicketForm) {
  return {
    name: d.name,
    title: d.title,
    description: d.description,
    type: d.type,
    priority: d.priority,
    impact: d.impact,
    urgency: d.urgency,
    requesterId: d.requesterId,
    assigneeId: d.assigneeId,
    groupId: d.groupId,
    categoryId: d.categoryId,
    serviceId: d.serviceId,
    frequency: d.frequency,
    interval: d.interval,
    timezone: d.timezone,
    firstDueAt: d.firstDueAt,
    createBeforeDays: d.createBeforeDays,
    isActive: d.isActive,
  };
}

function revalidate() {
  revalidatePath(PATH);
}

export async function createRecurringTicket(_prev: RecurringTicketState, formData: FormData): Promise<RecurringTicketState> {
  const me = await requireManagerUser();
  if (!me) return { ok: false, error: NOT_AUTHORISED };
  const parsed = parseRecurringTicketForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error, fieldErrors: parsed.fieldErrors };
  const d = parsed.data;
  const refError = await referenceError(d);
  if (refError) return { ok: false, error: refError };

  const columns = templateColumns(d);
  try {
    const row = await db.recurringTicket.create({
      data: {
        ...columns,
        importRef: d.importRef,
        lastCreatedFor: d.lastCreatedFor,
        nextDueAt: initialNextDue(recurrenceOf(columns), new Date(), d.lastCreatedFor),
        createdById: me.id,
      },
      select: { id: true, name: true, frequency: true, interval: true, nextDueAt: true },
    });
    await writeAudit({
      userId: me.id,
      action: "CREATE",
      entity: "RecurringTicket",
      entityId: row.id,
      summary: `Created recurring ticket "${row.name}" (${describeRecurrence(d.frequency, d.interval).toLowerCase()}, next due ${row.nextDueAt.toISOString()})`,
      meta: d.importRef ? { importRef: d.importRef } : undefined,
    });
    revalidate();
    return { ok: true, id: row.id };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "A recurring ticket with that import reference already exists." };
    throw e;
  }
}

export async function updateRecurringTicket(_prev: RecurringTicketState, formData: FormData): Promise<RecurringTicketState> {
  const me = await requireManagerUser();
  if (!me) return { ok: false, error: NOT_AUTHORISED };
  const id = String(formData.get("id") ?? "");
  const current = id ? await db.recurringTicket.findUnique({ where: { id } }) : null;
  if (!current) return { ok: false, error: NOT_FOUND };
  const parsed = parseRecurringTicketForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error, fieldErrors: parsed.fieldErrors };
  const d = parsed.data;
  const refError = await referenceError(d);
  if (refError) return { ok: false, error: refError };

  const columns = templateColumns(d);
  const resumed = d.isActive && !current.isActive;
  // A new recurrence (or a resume after a pause) starts from the next occurrence that isn't due yet.
  const recompute = resumed || recurrenceChanged(current, columns);
  const nextDueAt = recompute ? initialNextDue(recurrenceOf(columns), new Date(), current.lastCreatedFor) : undefined;
  const row = await db.recurringTicket.update({
    where: { id },
    data: { ...columns, ...(nextDueAt ? { nextDueAt } : {}) },
    select: { id: true, name: true, nextDueAt: true },
  });
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "RecurringTicket",
    entityId: row.id,
    summary: `Updated recurring ticket "${row.name}"${recompute ? ` (next due ${row.nextDueAt.toISOString()})` : ""}${
      current.isActive !== d.isActive ? (d.isActive ? ", resumed" : ", paused") : ""
    }`,
  });
  revalidate();
  return { ok: true, id: row.id };
}

/** Pause (`active=false`) or resume (`active=true`). Resuming skips occurrences that fell due while paused. */
export async function setRecurringTicketActive(formData: FormData): Promise<RecurringRunResult> {
  const me = await requireManagerUser();
  if (!me) return { ok: false, error: NOT_AUTHORISED };
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  const current = id ? await db.recurringTicket.findUnique({ where: { id } }) : null;
  if (!current) return { ok: false, error: NOT_FOUND };
  if (current.isActive === active) return { ok: true };

  const nextDueAt = active ? initialNextDue(recurrenceOf(current), new Date(), current.lastCreatedFor) : undefined;
  await db.recurringTicket.update({ where: { id }, data: { isActive: active, ...(nextDueAt ? { nextDueAt } : {}) } });
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "RecurringTicket",
    entityId: id,
    summary: active
      ? `Resumed recurring ticket "${current.name}" (next due ${nextDueAt!.toISOString()})`
      : `Paused recurring ticket "${current.name}"`,
  });
  revalidate();
  return { ok: true };
}

/** Tickets already created stay; only the schedule goes. */
export async function deleteRecurringTicket(formData: FormData): Promise<RecurringRunResult> {
  const me = await requireManagerUser();
  if (!me) return { ok: false, error: NOT_AUTHORISED };
  const id = String(formData.get("id") ?? "");
  const current = id ? await db.recurringTicket.findUnique({ where: { id }, select: { name: true } }) : null;
  if (!current) return { ok: false, error: NOT_FOUND };
  await db.recurringTicket.delete({ where: { id } });
  await writeAudit({ userId: me.id, action: "DELETE", entity: "RecurringTicket", entityId: id, summary: `Deleted recurring ticket "${current.name}"` });
  revalidate();
  return { ok: true };
}

/**
 * "Create now": create the ticket of the next occurrence that is not due yet
 * right away (also for a paused schedule). The schedule then moves on to the
 * occurrence after it, so that one is not created twice.
 */
export async function runRecurringTicketNow(formData: FormData): Promise<RecurringRunResult> {
  const me = await requireManagerUser();
  if (!me) return { ok: false, error: NOT_AUTHORISED };
  const id = String(formData.get("id") ?? "");
  const row = id ? await db.recurringTicket.findUnique({ where: { id } }) : null;
  if (!row) return { ok: false, error: NOT_FOUND };

  const res = await fireRecurringTicket(row, { now: new Date(), trigger: "MANUAL", actorId: me.id });
  revalidate();
  revalidatePath("/tickets");
  if (res.status === "CREATED") return { ok: true, ticketId: res.ticketId, ref: res.ref };
  if (res.status === "FAILED") return { ok: false, error: `The ticket could not be created: ${res.error}` };
  return { ok: false, error: "The schedule changed in the meantime. Reload and try again." };
}
