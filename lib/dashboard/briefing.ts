import { db } from "@/lib/db";
import { aiConfigured } from "@/lib/ai";
import { getSessionUser } from "@/lib/session";
import { OPEN_TICKET_STATUSES, changeRef, ticketRef } from "@/lib/constants";
import { loadBusinessCalendar, slaSnapshot } from "@/lib/sla";
import type { BusinessCalendarLike } from "@/lib/business-hours";
import {
  BRIEFING_ITEMS_PER_SECTION,
  PRE_START_CHANGE_STATUSES,
  ageLabel,
  changeStartWindow,
  customerRepliedLast,
  untilLabel,
} from "@/lib/dashboard/briefing-rules";
import type { BriefingItem, BriefingSection, Computed } from "@/lib/dashboard/types";

/** Tickets scanned per section; the briefing is a glance, not a report. */
const SCAN_LIMIT = 200;
const PER_SOURCE = BRIEFING_ITEMS_PER_SECTION;

const ACTIVE_UNPAUSED = ["NEW", "OPEN", "IN_PROGRESS"] as const;

const ticketHref = (id: number) => `/tickets/${id}`;
const changeHref = (id: number) => `/changes/${id}`;

const section = (key: BriefingSection["key"], title: string, total: number, items: BriefingItem[]): BriefingSection => ({
  key,
  title,
  total,
  items: items.slice(0, BRIEFING_ITEMS_PER_SECTION),
});

/** The viewer's tickets whose resolve SLA is breached or in its last stretch, worst first. */
async function slaSection(userId: string, now: Date): Promise<BriefingSection> {
  const tickets = await db.ticket.findMany({
    where: {
      assigneeId: userId,
      status: { in: [...ACTIVE_UNPAUSED] },
      resolvedAt: null,
      pendingSince: null,
      resolveDueAt: { not: null },
    },
    orderBy: { resolveDueAt: "asc" },
    take: SCAN_LIMIT,
    select: {
      id: true,
      prefix: true,
      title: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      resolveBreached: true,
      pendingSince: true,
      pausedMs: true,
      responseDueAt: true,
      resolveDueAt: true,
      dueAt: true,
      sla: { select: { businessCalendarId: true } },
    },
  });

  const calendars = new Map<string, BusinessCalendarLike | null>();
  const risky: { item: BriefingItem; breached: boolean }[] = [];
  for (const ticket of tickets) {
    const calendarId = ticket.sla?.businessCalendarId;
    if (calendarId && !calendars.has(calendarId)) calendars.set(calendarId, await loadBusinessCalendar(calendarId));
    const { state, dueAt } = slaSnapshot(ticket, now, calendarId ? (calendars.get(calendarId) ?? null) : null);
    if (state !== "BREACHED" && state !== "AT_RISK") continue;
    const breached = state === "BREACHED";
    risky.push({
      breached,
      item: {
        label: `${ticketRef(ticket.id, ticket.prefix)} ${ticket.title}`,
        detail: breached ? "SLA breached" : `SLA due ${untilLabel(dueAt!, now)}`,
        href: ticketHref(ticket.id),
        tone: breached ? "danger" : "warning",
      },
    });
  }
  risky.sort((a, b) => Number(b.breached) - Number(a.breached));
  return section("sla", "SLA at risk", risky.length, risky.map((r) => r.item));
}

/** Tickets where the customer wrote last (act now) or the clock waits on the customer. */
async function customerSection(userId: string, now: Date): Promise<BriefingSection> {
  const [candidates, waiting, waitingCount] = await Promise.all([
    db.ticket.findMany({
      where: { assigneeId: userId, status: { in: [...ACTIVE_UNPAUSED] } },
      orderBy: { updatedAt: "desc" },
      take: SCAN_LIMIT,
      select: {
        id: true,
        prefix: true,
        title: true,
        requesterId: true,
        comments: {
          where: { isInternal: false },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { authorId: true, createdAt: true },
        },
      },
    }),
    db.ticket.findMany({
      where: { assigneeId: userId, status: "PENDING", pendingReason: "AWAITING_CUSTOMER" },
      orderBy: { updatedAt: "asc" },
      take: PER_SOURCE,
      select: { id: true, prefix: true, title: true, pendingSince: true, updatedAt: true },
    }),
    db.ticket.count({ where: { assigneeId: userId, status: "PENDING", pendingReason: "AWAITING_CUSTOMER" } }),
  ]);

  const replied: BriefingItem[] = candidates.flatMap((ticket) => {
    const last = ticket.comments[0];
    if (!last || !customerRepliedLast(last.authorId, ticket.requesterId)) return [];
    return [
      {
        label: `${ticketRef(ticket.id, ticket.prefix)} ${ticket.title}`,
        detail: `Customer replied ${ageLabel(last.createdAt, now)} ago`,
        href: ticketHref(ticket.id),
      },
    ];
  });
  const waitingItems: BriefingItem[] = waiting.map((ticket) => ({
    label: `${ticketRef(ticket.id, ticket.prefix)} ${ticket.title}`,
    detail: `Waiting on customer for ${ageLabel(ticket.pendingSince ?? ticket.updatedAt, now)}`,
    href: ticketHref(ticket.id),
  }));
  return section("customer", "Customers", replied.length + waitingCount, [...replied, ...waitingItems]);
}

const GENERIC_APPROVAL_PATHS: Record<string, string> = {
  TICKET: "tickets",
  PROBLEM: "problems",
  CHANGE: "changes",
  SERVICE: "services",
};

/** Approvals waiting for the viewer's decision, oldest first, across tickets, changes and generic requests. */
async function approvalsSection(userId: string, now: Date): Promise<BriefingSection> {
  const pending = { approverId: userId, status: "PENDING" } as const;
  const ticketWhere = { ...pending, ticket: { status: { in: [...OPEN_TICKET_STATUSES] } } };
  const changeWhere = { ...pending, change: { status: "APPROVAL" } };
  const oldestFirst = { createdAt: "asc" } as const;

  const [tickets, ticketCount, changes, changeCount, requests, requestCount] = await Promise.all([
    db.ticketApproval.findMany({
      where: ticketWhere,
      orderBy: oldestFirst,
      take: PER_SOURCE,
      select: { createdAt: true, ticket: { select: { id: true, prefix: true, title: true } } },
    }),
    db.ticketApproval.count({ where: ticketWhere }),
    db.changeApproval.findMany({
      where: changeWhere,
      orderBy: oldestFirst,
      take: PER_SOURCE,
      select: { createdAt: true, change: { select: { id: true, title: true } } },
    }),
    db.changeApproval.count({ where: changeWhere }),
    db.approval.findMany({
      where: pending,
      orderBy: oldestFirst,
      take: PER_SOURCE,
      select: { createdAt: true, entityType: true, entityId: true, title: true },
    }),
    db.approval.count({ where: pending }),
  ]);

  const waitingSince = (createdAt: Date) => `Waiting ${ageLabel(createdAt, now)}`;
  const entries: { createdAt: Date; item: BriefingItem }[] = [
    ...tickets.map((a) => ({
      createdAt: a.createdAt,
      item: {
        label: `${ticketRef(a.ticket.id, a.ticket.prefix)} ${a.ticket.title}`,
        detail: waitingSince(a.createdAt),
        href: ticketHref(a.ticket.id),
      },
    })),
    ...changes.map((a) => ({
      createdAt: a.createdAt,
      item: {
        label: `${changeRef(a.change.id)} ${a.change.title}`,
        detail: waitingSince(a.createdAt),
        href: changeHref(a.change.id),
      },
    })),
    ...requests.map((a) => ({
      createdAt: a.createdAt,
      item: {
        label: a.title || `${a.entityType} ${a.entityId}`,
        detail: waitingSince(a.createdAt),
        href: `/${GENERIC_APPROVAL_PATHS[a.entityType] ?? "approvals"}/${a.entityId}`,
      },
    })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return section("approvals", "Approvals for you", ticketCount + changeCount + requestCount, entries.map((e) => e.item));
}

/** Changes the viewer owns that start within 24 hours and are not underway yet. */
async function changesSection(userId: string, now: Date): Promise<BriefingSection> {
  const { from, to } = changeStartWindow(now);
  const where = {
    assigneeId: userId,
    status: { in: [...PRE_START_CHANGE_STATUSES] },
    plannedStart: { gte: from, lte: to },
  };
  const [changes, total] = await Promise.all([
    db.change.findMany({
      where,
      orderBy: { plannedStart: "asc" },
      take: PER_SOURCE,
      select: { id: true, title: true, status: true, plannedStart: true },
    }),
    db.change.count({ where }),
  ]);

  return section(
    "changes",
    "Your changes starting within 24h",
    total,
    changes.map((change) => {
      const approved = change.status === "APPROVED" || change.status === "SCHEDULED";
      return {
        label: `${changeRef(change.id)} ${change.title}`,
        detail: `Starts ${untilLabel(change.plannedStart!, now)}${approved ? "" : ", not approved yet"}`,
        href: changeHref(change.id),
        tone: approved ? undefined : "warning",
      };
    }),
  );
}

/** What needs the user's attention today, from the user's own queue. */
export async function loadBriefingSections(userId: string, now: Date = new Date()): Promise<BriefingSection[]> {
  return Promise.all([
    slaSection(userId, now),
    customerSection(userId, now),
    approvalsSection(userId, now),
    changesSection(userId, now),
  ]);
}

/** The briefing widget's data for the signed-in viewer. Per viewer, so it is never cached across users. */
export async function computeBriefing(): Promise<Computed> {
  const me = await getSessionUser();
  if (!me) return { kind: "empty" };
  const [sections, aiAvailable] = await Promise.all([loadBriefingSections(me.id), aiConfigured()]);
  return { kind: "briefing", sections, aiAvailable };
}
