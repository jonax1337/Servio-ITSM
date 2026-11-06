import { unstable_cache } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { OPEN_TICKET_STATUSES, PENDING_STATUSES } from "@/lib/constants";
import { AT_RISK_FRACTION, loadBusinessCalendar, slaSnapshot } from "@/lib/sla";
import type { BusinessCalendarLike } from "@/lib/business-hours";

/**
 * The SLA filter of the ticket list, on the live SLA clock (`slaSnapshot`): the same
 * state the SLA column and badge show, so a filter never disagrees with a ticket's
 * badge. Paused (PENDING/ON_HOLD) tickets are neither breached nor at risk — their
 * clock is stopped — and finished tickets have no clock: like tickets without a
 * deadline they are "No active SLA".
 */
export const SLA_VIEWS = ["breached", "at_risk", "on_track", "paused", "none"] as const;
export type SlaView = (typeof SLA_VIEWS)[number];

export const SLA_VIEW_META: Record<SlaView, { label: string; description: string }> = {
  breached: { label: "Breached", description: "Active tickets already past their resolve deadline" },
  at_risk: { label: "At risk", description: "Active tickets in the last 20% of their resolve window" },
  on_track: { label: "On track", description: "Active tickets with time left on their resolve deadline" },
  paused: { label: "Paused", description: "Tickets whose SLA clock is stopped while they wait" },
  none: { label: "No active SLA", description: "Tickets without a deadline, and finished tickets" },
};

/** The `sla` URL param (list page, CSV export, dashboard filters) → a known view, or undefined. */
export function parseSlaView(value: string | null | undefined): SlaView | undefined {
  return SLA_VIEWS.find((v) => v === value);
}

/** The tickets list filtered to one SLA view — the target of dashboard tiles. */
export function slaViewHref(view: SlaView): string {
  return `/tickets?sla=${view}`;
}

type SlaViewTicket = Parameters<typeof slaSnapshot>[0];
type WithCalendar = { sla: { businessCalendarId: string | null } | null };

const FINISHED_STATUSES = ["RESOLVED", "CLOSED", "CANCELLED"];

/** A running (or paused) SLA clock; tickets without one have `null`. */
export type SlaClockState = "BREACHED" | "AT_RISK" | "ON_TRACK" | "PAUSED";
export type SlaClock = { state: SlaClockState; dueAt: Date };

const URGENCY_TIER: Record<SlaClockState, number> = { BREACHED: 0, AT_RISK: 1, ON_TRACK: 2, PAUSED: 3 };
const NO_CLOCK_TIER = 4;

const isClockState = (state: string): state is SlaClockState => state in URGENCY_TIER;

const STATE_OF_VIEW: Record<Exclude<SlaView, "none">, SlaClockState> = {
  breached: "BREACHED",
  at_risk: "AT_RISK",
  on_track: "ON_TRACK",
  paused: "PAUSED",
};

/** The SLA clock of an unfinished ticket with a deadline, or null for finished tickets and tickets without one. */
export function activeSlaClock(
  ticket: SlaViewTicket,
  now: Date = new Date(),
  calendar: BusinessCalendarLike | null = null,
): SlaClock | null {
  if (FINISHED_STATUSES.includes(ticket.status)) return null;
  const { state, dueAt } = slaSnapshot(ticket, now, calendar);
  return dueAt && isClockState(state) ? { state, dueAt } : null;
}

/** Whether a ticket belongs to the view right now. */
export function matchesSlaView(
  view: SlaView,
  ticket: SlaViewTicket,
  now: Date = new Date(),
  calendar: BusinessCalendarLike | null = null,
): boolean {
  const clock = activeSlaClock(ticket, now, calendar);
  return view === "none" ? clock === null : clock?.state === STATE_OF_VIEW[view];
}

/**
 * Orders clocks by urgency: breached first, then at risk, on track and paused; within a state the
 * nearest deadline first (for breached that is the longest overdue). Tickets without a clock go last.
 */
export function compareSlaUrgency(a: SlaClock | null, b: SlaClock | null): number {
  const tierA = a ? URGENCY_TIER[a.state] : NO_CLOCK_TIER;
  const tierB = b ? URGENCY_TIER[b.state] : NO_CLOCK_TIER;
  if (tierA !== tierB) return tierA - tierB;
  return a && b ? a.dueAt.getTime() - b.dueAt.getTime() : 0;
}

/** The clocks of the tickets, in order; business calendars are loaded once per calendar. */
export async function activeSlaClocks<T extends SlaViewTicket & WithCalendar>(
  tickets: readonly T[],
  now: Date = new Date(),
): Promise<(SlaClock | null)[]> {
  const calendars = new Map<string, BusinessCalendarLike | null>();
  for (const { sla } of tickets) {
    const id = sla?.businessCalendarId;
    if (id && !calendars.has(id)) calendars.set(id, await loadBusinessCalendar(id));
  }
  return tickets.map((t) => activeSlaClock(t, now, calendars.get(t.sla?.businessCalendarId ?? "") ?? null));
}

/** Sorts by SLA urgency (`dir` "asc" = most urgent first); ties keep newest activity first, then highest id. */
export async function sortBySlaUrgency<T extends SlaViewTicket & WithCalendar & { id: number; updatedAt: Date }>(
  rows: readonly T[],
  dir: "asc" | "desc",
  now: Date = new Date(),
): Promise<T[]> {
  const clocks = await activeSlaClocks(rows, now);
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, clock: clocks[i] }))
    .sort((a, b) =>
      sign * compareSlaUrgency(a.clock, b.clock) ||
      b.row.updatedAt.getTime() - a.row.updatedAt.getTime() ||
      b.row.id - a.row.id)
    .map(({ row }) => row);
}

const MINUTE_MS = 60_000;
/** SQLite and Postgres both cap the variables of one statement; an id list is split well below the lowest cap. */
const MAX_IDS_PER_IN = 900;
const SLA_VIEW_CACHE_SECONDS = 60;

const hasDeadline = (filter: Prisma.DateTimeNullableFilter): Prisma.TicketWhereInput => ({
  OR: [{ resolveDueAt: filter }, { resolveDueAt: null, dueAt: filter }],
});

const isPaused: Prisma.TicketWhereInput = { OR: [{ pendingSince: { not: null } }, { status: { in: [...PENDING_STATUSES] } }] };
const isRunning: Prisma.TicketWhereInput = { pendingSince: null, status: { notIn: [...PENDING_STATUSES] } };

/** Finished tickets and tickets without a deadline: the ones `activeSlaClock` gives no clock. */
const NO_ACTIVE_SLA_WHERE: Prisma.TicketWhereInput = {
  OR: [{ status: { in: FINISHED_STATUSES } }, { resolvedAt: { not: null } }, { resolveDueAt: null, dueAt: null }],
};

/** The classified views: every view whose membership needs the live clock rather than a plain filter. */
type ClockView = Exclude<SlaView, "none">;

/**
 * The candidates worth classifying in memory for a view, as a SQL filter. Tickets on a business
 * calendar always pass: their clock counts working time, so the wall-clock deadline says nothing
 * about them. The others are narrowed by the wall-clock deadline: breached means it has passed,
 * at risk means it is still ahead but within the last fifth of the longest SLA window, on track
 * means it is still ahead. Paused tickets are the ones whose clock is stopped.
 * \`longestWindowMs\` is the longest resolve target of any SLA; a ticket without an SLA has no known window and is only bounded below.
 */
export function slaViewCandidateWhere(view: ClockView, now: Date, longestWindowMs: number): Prisma.TicketWhereInput {
  const open: Prisma.TicketWhereInput = { status: { in: [...OPEN_TICKET_STATUSES] }, resolvedAt: null };
  if (view === "paused") return { ...open, AND: [hasDeadline({ not: null }), isPaused] };

  const onBusinessCalendar: Prisma.TicketWhereInput = { sla: { businessCalendarId: { not: null } } };
  const onWallClock: Prisma.TicketWhereInput = { OR: [{ slaId: null }, { sla: { businessCalendarId: null } }] };
  const horizon = new Date(now.getTime() + AT_RISK_FRACTION * longestWindowMs);
  const wallClockWindow: Prisma.TicketWhereInput =
    view === "breached"
      ? hasDeadline({ lt: now })
      : view === "on_track"
        ? hasDeadline({ gte: now })
        : { AND: [hasDeadline({ gte: now }), { OR: [{ slaId: null }, hasDeadline({ lte: horizon })] }] };
  return {
    ...open,
    AND: [hasDeadline({ not: null }), isRunning, { OR: [onBusinessCalendar, { AND: [onWallClock, wallClockWindow] }] }],
  };
}

/** \`id IN (...)\` for a long id list, split into chunks the database accepts. */
export function ticketIdsFilter(ids: readonly number[]): Prisma.TicketWhereInput {
  const chunks: Prisma.TicketWhereInput[] = [];
  for (let start = 0; start < ids.length; start += MAX_IDS_PER_IN) {
    chunks.push({ id: { in: ids.slice(start, start + MAX_IDS_PER_IN) } });
  }
  return chunks.length > 0 ? { OR: chunks } : { id: { in: [] } };
}

async function classifySlaViewTickets(view: ClockView, now: Date): Promise<number[]> {
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
  const clocks = await activeSlaClocks(candidates, now);
  return candidates.filter((_, i) => clocks[i]?.state === STATE_OF_VIEW[view]).map((t) => t.id);
}

/**
 * Ids of the tickets in a view. The at-risk window is relative to each ticket's
 * own budget (and business calendar), which SQL cannot express portably, so a SQL
 * prefilter (\`slaViewCandidateWhere\`) cuts the candidates and those are classified in
 * memory. The result is cached for a minute per view, like the dashboard tiles.
 */
export function findSlaViewTicketIds(view: ClockView): Promise<number[]> {
  return unstable_cache(() => classifySlaViewTickets(view, new Date()), ["sla-view-ticket-ids", view], {
    revalidate: SLA_VIEW_CACHE_SECONDS,
  })();
}

/** The ticket filter for a view: a plain filter for "No active SLA", otherwise the (cached) ids currently in it. */
export async function slaViewWhere(view: SlaView): Promise<Prisma.TicketWhereInput> {
  return view === "none" ? NO_ACTIVE_SLA_WHERE : ticketIdsFilter(await findSlaViewTicketIds(view));
}
