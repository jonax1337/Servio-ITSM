import { db } from "@/lib/db";
import { OPEN_TICKET_STATUSES } from "@/lib/constants";
import { loadBusinessCalendar, slaSnapshot } from "@/lib/sla";
import type { BusinessCalendarLike } from "@/lib/business-hours";

/**
 * Built-in ticket list views on the live SLA clock (`slaSnapshot`): the same
 * state the SLA badge shows, so a view never disagrees with a ticket's badge.
 * Paused (PENDING/ON_HOLD) tickets are neither breached nor at risk — their
 * clock is stopped — and finished tickets are history, not a worklist.
 */
export const SLA_VIEWS = ["breached", "at_risk"] as const;
export type SlaView = (typeof SLA_VIEWS)[number];

export const SLA_VIEW_META: Record<SlaView, { label: string; description: string }> = {
  breached: { label: "SLA breached", description: "Active tickets already past their resolve deadline" },
  at_risk: { label: "SLA at risk", description: "Active tickets in the last 20% of their resolve window" },
};

const SLA_STATE_OF_VIEW = { breached: "BREACHED", at_risk: "AT_RISK" } as const;

/** The `sla` URL param (list page, CSV export, dashboard filters) → a known view, or undefined. */
export function parseSlaView(value: string | null | undefined): SlaView | undefined {
  return SLA_VIEWS.find((v) => v === value);
}

/** The tickets list filtered to one SLA view — the target of dashboard tiles and the view chips. */
export function slaViewHref(view: SlaView): string {
  return `/tickets?sla=${view}`;
}

type SlaViewTicket = Parameters<typeof slaSnapshot>[0];

const FINISHED_STATUSES = ["RESOLVED", "CLOSED", "CANCELLED"];

/** Whether an active ticket belongs to the view right now. */
export function matchesSlaView(
  view: SlaView,
  ticket: SlaViewTicket,
  now: Date = new Date(),
  calendar: BusinessCalendarLike | null = null,
): boolean {
  if (FINISHED_STATUSES.includes(ticket.status)) return false;
  return slaSnapshot(ticket, now, calendar).state === SLA_STATE_OF_VIEW[view];
}

/**
 * Ids of the tickets in a view. The at-risk window is relative to each ticket's
 * own budget (and business calendar), which SQL cannot express portably, so the
 * candidates (active tickets with a deadline) are classified in memory.
 */
export async function findSlaViewTicketIds(view: SlaView, now: Date = new Date()): Promise<number[]> {
  const candidates = await db.ticket.findMany({
    where: {
      status: { in: [...OPEN_TICKET_STATUSES] },
      resolvedAt: null,
      OR: [{ resolveDueAt: { not: null } }, { dueAt: { not: null } }],
    },
    select: {
      id: true, status: true, createdAt: true, resolvedAt: true, resolveBreached: true,
      responseDueAt: true, resolveDueAt: true, dueAt: true, pendingSince: true, pausedMs: true,
      sla: { select: { businessCalendarId: true } },
    },
  });
  const calendars = new Map<string, BusinessCalendarLike | null>();
  const matching: number[] = [];
  for (const ticket of candidates) {
    const calendarId = ticket.sla?.businessCalendarId ?? null;
    if (calendarId && !calendars.has(calendarId)) calendars.set(calendarId, await loadBusinessCalendar(calendarId));
    const calendar = calendarId ? calendars.get(calendarId) ?? null : null;
    if (matchesSlaView(view, ticket, now, calendar)) matching.push(ticket.id);
  }
  return matching;
}
