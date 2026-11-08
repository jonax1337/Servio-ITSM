/**
 * Creates the ticket of one recurring-ticket occurrence. Shared by the scheduler
 * tick (lib/ticks/recurring-tickets.ts) and the console's "Create now".
 *
 * Exactly-once: the occurrence is claimed with a conditional update of
 * `nextDueAt` (compare-and-set on the value read) BEFORE the ticket is created.
 * A concurrent tick, a second replica or a restart then finds the marker moved
 * and creates nothing. The ticket goes through `createTicketCore` (SLA, VIP
 * repricing, mails, TICKET_CREATED automations, auto-assign) with source
 * RECURRING. If creation fails after the claim, the occurrence is not retried
 * automatically (at most once); `lastError` and a notification to the
 * schedule's creator say why, and "Create now" re-runs it by hand.
 *
 * Privileged server code: the caller has authorised `actorId`.
 */
import type { RecurringTicket } from "@prisma/client";
import { db } from "@/lib/db";
import { notify, writeAudit } from "@/lib/audit";
import { createTicketCore } from "@/lib/ticket-core";
import { ticketRef } from "@/lib/constants";
import { recurrenceOf } from "@/lib/recurring-ticket-input";
import { nextToCreate } from "@/lib/recurring-ticket-rules";

export type FireResult =
  | { status: "CREATED"; ticketId: number; ref: string; dueAt: Date; skipped: number }
  | { status: "NOT_DUE" | "CLAIMED" }
  | { status: "FAILED"; error: string; dueAt: Date };

type TicketType = "INCIDENT" | "REQUEST";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type Level = "LOW" | "MEDIUM" | "HIGH";

/**
 * Create the ticket for the schedule's open occurrence (see `nextToCreate`).
 * `trigger` SCHEDULE only fires an active schedule whose creation window is
 * open; MANUAL ("Create now") creates the next occurrence right away.
 */
export async function fireRecurringTicket(
  row: RecurringTicket,
  opts: { now: Date; trigger: "SCHEDULE" | "MANUAL"; actorId: string },
): Promise<FireResult> {
  const plan = nextToCreate(recurrenceOf(row), row.nextDueAt, opts.now, { force: opts.trigger === "MANUAL" });
  if (!plan) return { status: "NOT_DUE" };

  const claimed = await db.recurringTicket.updateMany({
    where: { id: row.id, nextDueAt: row.nextDueAt, ...(opts.trigger === "SCHEDULE" ? { isActive: true } : {}) },
    data: { nextDueAt: plan.nextDueAt, lastCreatedFor: plan.dueAt },
  });
  if (claimed.count === 0) return { status: "CLAIMED" };

  const dueIso = plan.dueAt.toISOString();
  const meta = { trigger: opts.trigger, dueAt: dueIso, skippedOccurrences: plan.skipped };
  try {
    const requesterId = row.requesterId ?? row.createdById;
    if (!requesterId) throw new Error("The schedule has no requester (its creator was deleted). Edit it and choose one.");
    const ticket = await createTicketCore(
      {
        title: row.title,
        description: row.description,
        type: row.type as TicketType,
        priority: row.priority as Priority,
        impact: row.impact as Level,
        urgency: row.urgency as Level,
        source: "RECURRING",
        requesterId,
        requestedByUserId: null,
        assigneeId: row.assigneeId,
        groupId: row.groupId,
        categoryId: row.categoryId,
        serviceId: row.serviceId,
        slaId: null,
      },
      opts.actorId,
    );
    // The occurrence's due date becomes the ticket's due date (distinct from the SLA clock).
    await db.ticket.update({ where: { id: ticket.id }, data: { dueDate: plan.dueAt } });
    await db.recurringTicket.updateMany({ where: { id: row.id }, data: { lastTicketId: ticket.id, lastError: null } });
    const ref = ticketRef(ticket.id, ticket.prefix);
    await writeAudit({
      userId: opts.actorId,
      action: "AUTOMATION",
      entity: "RecurringTicket",
      entityId: row.id,
      summary: `Created ${ref} from recurring ticket "${row.name}" (due ${dueIso})${plan.skipped ? `, skipped ${plan.skipped} missed occurrence(s)` : ""}`,
      meta: { ...meta, ticketId: ticket.id },
    });
    return { status: "CREATED", ticketId: ticket.id, ref, dueAt: plan.dueAt, skipped: plan.skipped };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await db.recurringTicket.updateMany({ where: { id: row.id }, data: { lastError: error } });
    await writeAudit({
      userId: opts.actorId,
      action: "AUTOMATION",
      entity: "RecurringTicket",
      entityId: row.id,
      summary: `Could not create the ticket of recurring ticket "${row.name}" (due ${dueIso}): ${error}`,
      meta: { ...meta, error },
    });
    if (row.createdById) {
      await notify(row.createdById, {
        type: "RECURRING_TICKET_FAILED",
        title: `Recurring ticket "${row.name}" could not create its ticket`,
        body: error,
        entity: "RecurringTicket",
        entityId: row.id,
        email: { kind: "RECURRING_FAILED", name: row.name, error },
      });
    }
    return { status: "FAILED", error, dueAt: plan.dueAt };
  }
}
