import type { Metadata } from "next";
import { Repeat } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { getFormOptions } from "@/lib/data/options";
import { ticketRef } from "@/lib/constants";
import { frequencyOf, recurrenceOf } from "@/lib/recurring-ticket-input";
import { creationTimeFor, localDateTimeParts } from "@/lib/recurring-ticket-rules";
import { PageHeader, PageBody } from "@/components/page-header";
import {
  RecurringTicketManager,
  type RecurringTicketListRow,
} from "@/components/recurring-tickets/recurring-ticket-manager";

export const metadata: Metadata = { title: "Recurring tickets" };
export const dynamic = "force-dynamic";

/** "10 Dec 2026, 09:00" on the schedule's own wall clock. */
function formatIn(instant: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(instant);
  } catch {
    return instant.toISOString();
  }
}

export default async function RecurringTicketsSettingsPage() {
  const me = await requireRole("MANAGER");

  const [rows, options, requesters] = await Promise.all([
    db.recurringTicket.findMany({
      orderBy: [{ isActive: "desc" }, { nextDueAt: "asc" }],
      include: { group: { select: { name: true } } },
    }),
    getFormOptions(),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
  ]);

  const lastTickets = await db.ticket.findMany({
    where: { id: { in: rows.flatMap((r) => (r.lastTicketId ? [r.lastTicketId] : [])) } },
    select: { id: true, prefix: true },
  });
  const refOf = new Map(lastTickets.map((t) => [t.id, ticketRef(t.id, t.prefix)]));

  const list: RecurringTicketListRow[] = rows.map((r) => {
    const local = localDateTimeParts(r.firstDueAt, r.timezone);
    return {
      id: r.id,
      name: r.name,
      isActive: r.isActive,
      title: r.title,
      description: r.description,
      type: r.type,
      priority: r.priority,
      impact: r.impact,
      urgency: r.urgency,
      requesterId: r.requesterId,
      assigneeId: r.assigneeId,
      groupId: r.groupId,
      groupName: r.group?.name ?? null,
      categoryId: r.categoryId,
      serviceId: r.serviceId,
      frequency: frequencyOf(r.frequency),
      interval: r.interval,
      timezone: r.timezone,
      firstDueDate: local.date,
      dueTime: local.time,
      createBeforeDays: r.createBeforeDays,
      nextDueLabel: formatIn(r.nextDueAt, r.timezone),
      nextCreateLabel: formatIn(creationTimeFor(recurrenceOf(r), r.nextDueAt), r.timezone),
      lastCreatedLabel: r.lastCreatedFor ? formatIn(r.lastCreatedFor, r.timezone) : null,
      lastTicketId: r.lastTicketId && refOf.has(r.lastTicketId) ? r.lastTicketId : null,
      lastTicketRef: r.lastTicketId ? refOf.get(r.lastTicketId) ?? null : null,
      lastError: r.lastError,
    };
  });

  return (
    <>
      <PageHeader
        icon={Repeat}
        title="Recurring tickets"
        description="Create tickets on a schedule for routine work — certificate renewals, licence reviews, backup restore tests. Each occurrence opens one ticket through the normal pipeline (SLA, automations, notifications), a set number of days before it is due."
      />
      <PageBody>
        <RecurringTicketManager
          rows={list}
          currentUserId={me.id}
          requesters={requesters.map((u) => ({ value: u.id, label: u.name ?? u.email, hint: u.email }))}
          agents={options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email, hint: a.email }))}
          groups={options.groups.map((g) => ({ value: g.id, label: g.name }))}
          categories={options.categories.map((c) => ({ value: c.id, label: c.name }))}
          services={options.services.map((s) => ({ value: s.id, label: s.name }))}
        />
      </PageBody>
    </>
  );
}
