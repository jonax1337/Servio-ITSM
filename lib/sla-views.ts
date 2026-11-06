import { unstable_cache } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { OPEN_TICKET_STATUSES } from "@/lib/constants";
import { AT_RISK_FRACTION, loadBusinessCalendar, slaSnapshot } from "@/lib/sla";
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

const MINUTE_MS = 60_000;
/** SQLite and Postgres both cap the variables of one statement; an id list is split well below the lowest cap. */
const MAX_IDS_PER_IN = 900;
const SLA_VIEW_CACHE_SECONDS = 60;

const hasDeadline = (filter: Prisma.DateTimeNullableFilter): Prisma.TicketWhereInput => ({
  OR: [{ resolveDueAt: filter }, { resolveDueAt: null, dueAt: filter }],
});

/**
 * The candidates worth classifying in memory for a view, as a SQL filter. Tickets on a business
 * calendar always pass: their clock counts working time, so the wall-clock deadline says nothing
 * about them. The others are narrowed by the wall-clock deadline: breached means it has passed,
 * at risk means it is still ahead but within the last fifth of the longest SLA window.
 * `longestWindowMs` is the longest resolve target of any SLA; a ticket without an SLA has no known window and is only bounded below.
 */
export function slaViewCandidateWhere(view: SlaView, now: Date, longestWindowMs: number): Prisma.TicketWhereInput {
  const onBusinessCalendar: Prisma.TicketWhereInput = { sla: { businessCalendarId: { not: null } } };
  const onWallClock: Prisma.TicketWhereInput = { OR: [{ slaId: null }, { sla: { businessCalendarId: null } }] };
  const horizon = new Date(now.getTime() + AT_RISK_FRACTION * longestWindowMs);
  const wallClockWindow: Prisma.TicketWhereInput =
    view === "breached"
      ? hasDeadline({ lt: now })
      : { AND: [hasDeadline({ gte: now }), { OR: [{ slaId: null }, hasDeadline({ lte: horizon })] }] };
  return {
    status: { in: [...OPEN_TICKET_STATUSES] },
    resolvedAt: null,
    AND: [hasDeadline({ not: null }), { OR: [onBusinessCalendar, { AND: [onWallClock, wallClockWindow] }] }],
  };
}

/** `id IN (...)` for a long id list, split into chunks the database accepts. */
export function ticketIdsFilter(ids: readonly number[]): Prisma.TicketWhereInput {
  const chunks: Prisma.TicketWhereInput[] = [];
  for (let start = 0; start < ids.length; start += MAX_IDS_PER_IN) {
    chunks.push({ id: { in: ids.slice(start, start + MAX_IDS_PER_IN) } });
  }
  return chunks.length > 0 ? { OR: chunks } : { id: { in: [] } };
}

async function classifySlaViewTickets(view: SlaView, now: Date): Promise<number[]> {
  const longestResolve = await db.sLA.aggregate({ _max: { resolveMins: true } });
  const longestWindowMs = (longestResolve._max.resolveMins ?? 0) * MINUTE_MS;
  const candidates = await db.ticket.findMany({
    where: slaViewCandidateWhere(view, now, longestWindowMs),
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

/**
 * Ids of the tickets in a view. The at-risk window is relative to each ticket's
 * own budget (and business calendar), which SQL cannot express portably, so a SQL
 * prefilter (`slaViewCandidateWhere`) cuts the candidates and those are classified in
 * memory. The result is cached for a minute per view, like the dashboard tiles.
 */
export function findSlaViewTicketIds(view: SlaView): Promise<number[]> {
  return unstable_cache(() => classifySlaViewTickets(view, new Date()), ["sla-view-ticket-ids", view], {
    revalidate: SLA_VIEW_CACHE_SECONDS,
  })();
}
