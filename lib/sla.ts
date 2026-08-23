import { db } from "@/lib/db";
import {
  addBusinessMs,
  elapsedBusinessMs,
  isAlwaysOpen,
  type BusinessCalendarLike,
} from "@/lib/business-hours";

// ---------------------------------------------------------------------------
// SLA clock. Deadlines are stored as absolute timestamps on the ticket and
// shifted forward whenever the ticket is paused (PENDING/ON_HOLD), so elapsed
// paused time never counts against the SLA.
//
// Business-hours calendars: when an SLA carries a `businessCalendarId`, the
// response/resolve deadlines are computed by ADDING the target duration in
// BUSINESS time (see lib/business-hours.ts) instead of wall-clock, and the
// live "at-risk"/"breached" snapshot measures elapsed BUSINESS time against the
// business budget. Without a calendar the original 24/7 wall-clock path runs
// unchanged.
// ---------------------------------------------------------------------------

export type SlaState = "ON_TRACK" | "AT_RISK" | "BREACHED" | "MET" | "PAUSED" | "NONE";

type SlaInput = { slaId?: string | null; serviceId?: string | null; priority?: string | null };

/** Resolve which SLA applies: explicit → service → priority match. */
export async function resolveSla(input: SlaInput) {
  if (input.slaId) {
    const sla = await db.sLA.findUnique({ where: { id: input.slaId } });
    if (sla && sla.isActive) return sla;
  }
  if (input.serviceId) {
    const service = await db.service.findUnique({
      where: { id: input.serviceId },
      include: { sla: true },
    });
    if (service?.sla?.isActive) return service.sla;
  }
  if (input.priority) {
    const byPriority = await db.sLA.findFirst({
      where: { priority: input.priority, isActive: true },
      orderBy: { name: "asc" }, // deterministic when several share a priority
    });
    if (byPriority) return byPriority;
  }
  return null;
}

/**
 * Load a business calendar (+holidays) by id, returned in the shape the pure
 * business-hours helpers expect. Returns null when the id is missing, unknown,
 * or the schedule is effectively 24/7 (so callers transparently fall back to
 * the wall-clock path). Kept internal to this module — the only DB access the
 * business-hours logic needs.
 */
export async function loadBusinessCalendar(
  businessCalendarId: string | null | undefined,
): Promise<BusinessCalendarLike | null> {
  if (!businessCalendarId) return null;
  const cal = await db.businessCalendar.findUnique({
    where: { id: businessCalendarId },
    select: { timezone: true, weeklyHours: true, holidays: { select: { date: true } } },
  });
  if (!cal) return null;
  const like: BusinessCalendarLike = {
    timezone: cal.timezone,
    weeklyHours: cal.weeklyHours,
    holidays: cal.holidays,
  };
  // A 24/7 schedule is identical to wall-clock — skip the calendar entirely.
  return isAlwaysOpen(like) ? null : like;
}

/**
 * The business calendar attached to a ticket's SLA (null when the ticket has no
 * SLA or the SLA is 24/7). Callers fetching a ticket for a status/clock change
 * should `include: { sla: { select: { businessCalendarId: true } } }` and pass
 * the result into statusChangeData/resumeData so pause shifts stay in business
 * time.
 */
export async function ticketCalendar(
  ticket: { sla?: { businessCalendarId: string | null } | null },
): Promise<BusinessCalendarLike | null> {
  return loadBusinessCalendar(ticket.sla?.businessCalendarId ?? null);
}

/**
 * Compute a deadline `mins` minutes after `from`. When a business calendar is
 * supplied the minutes are counted in BUSINESS time; otherwise wall-clock.
 * Returns null when the calendar is degenerate (no open time at all) — such a
 * deadline would equal `from` and breach instantly, so callers treat it as
 * "no computable SLA clock".
 */
export function deadlineFrom(
  from: Date,
  mins: number,
  calendar: BusinessCalendarLike | null,
): Date | null {
  const durationMs = mins * 60_000;
  if (!calendar) return new Date(from.getTime() + durationMs);
  const d = addBusinessMs(from, durationMs, calendar);
  return d.getTime() === from.getTime() ? null : d;
}

/**
 * Data to spread into `ticket.create` — resolves the SLA and stamps the
 * response/resolve deadlines. Returns `{}` when no SLA applies. When the SLA has
 * a business calendar, deadlines honour working hours + holidays.
 */
export async function slaCreateData(input: SlaInput, from: Date = new Date()) {
  const sla = await resolveSla(input);
  if (!sla) return {} as Record<string, never>;
  const calendar = await loadBusinessCalendar(sla.businessCalendarId);
  const responseDueAt = deadlineFrom(from, sla.responseMins, calendar);
  const resolveDueAt = deadlineFrom(from, sla.resolveMins, calendar);
  // Degenerate calendar (no open time): no computable clock — don't stamp
  // deadlines that would breach the instant the ticket is created.
  if (!responseDueAt && !resolveDueAt) return {} as Record<string, never>;
  return { slaId: sla.id, responseDueAt, resolveDueAt, dueAt: resolveDueAt };
}

type ClockTicket = {
  responseDueAt: Date | null;
  resolveDueAt: Date | null;
  dueAt: Date | null;
  pendingSince: Date | null;
  pausedMs: number;
};

/** Fields to write when a ticket enters a paused (PENDING/ON_HOLD) state. */
export function pauseData(ticket: { pendingSince: Date | null }, now: Date = new Date()) {
  if (ticket.pendingSince) return {}; // already paused — don't reset the anchor
  return { pendingSince: now };
}

/**
 * Fields to write when a ticket leaves a paused state: shift deadlines forward
 * by the time the ticket was actually paused. Wall-clock SLAs shift by the raw
 * pause delta; business-hours SLAs shift by the BUSINESS time consumed during
 * the pause (a weekend pause consumes zero working time) so the shifted
 * deadline keeps its original working-time budget.
 */
export function resumeData(
  ticket: ClockTicket,
  now: Date = new Date(),
  calendar: BusinessCalendarLike | null = null,
) {
  if (!ticket.pendingSince) return {};
  const rawDelta = Math.max(0, now.getTime() - ticket.pendingSince.getTime());
  const delta = calendar ? elapsedBusinessMs(ticket.pendingSince, now, calendar) : rawDelta;
  const shift = (d: Date | null) =>
    d ? (calendar ? addBusinessMs(d, delta, calendar) : new Date(d.getTime() + delta)) : d;
  return {
    pendingSince: null,
    pausedMs: ticket.pausedMs + delta,
    responseDueAt: shift(ticket.responseDueAt),
    resolveDueAt: shift(ticket.resolveDueAt),
    dueAt: shift(ticket.dueAt),
  };
}

/** Stamp the first-response clock (called on the first public agent reply). */
export function firstResponseData(ticket: { responseDueAt: Date | null }, now: Date = new Date()) {
  return {
    firstResponseAt: now,
    responseBreached: ticket.responseDueAt ? now > ticket.responseDueAt : false,
  };
}

/**
 * Whether the first-response SLA is currently breached: a response deadline
 * exists, no first response has been recorded, the clock isn't paused, and the
 * deadline has passed. Used by the escalation sweep to detect response breaches
 * (the resolve-focused `slaSnapshot` only looks at the resolve deadline).
 *
 * NB: like the rest of this module, this runs on wall-clock time — business-hours
 * calendars are a later refinement and are not applied here.
 */
export function firstResponseBreached(
  ticket: {
    status: string;
    responseDueAt: Date | null;
    firstResponseAt: Date | null;
    pendingSince: Date | null;
  },
  now: Date = new Date(),
): boolean {
  if (!ticket.responseDueAt || ticket.firstResponseAt) return false;
  if (ticket.pendingSince || ["PENDING", "ON_HOLD"].includes(ticket.status)) return false;
  return now > ticket.responseDueAt;
}

/** Whether the resolve SLA was breached, given the resolution time. */
export function resolveBreachData(ticket: { resolveDueAt: Date | null }, resolvedAt: Date) {
  return { resolveBreached: ticket.resolveDueAt ? resolvedAt > ticket.resolveDueAt : false };
}

/**
 * The side-effect fields to write when a ticket's status changes to `value`
 * (everything except the `status` column itself): SLA pause on entering
 * PENDING/ON_HOLD, resume+deadline-shift on leaving, resolve/close stamping,
 * and reopen clearing. Shared by the console (updateTicketField) and the
 * automation engine so both keep the SLA clock and resolution stamps in sync.
 */
export function statusChangeData(
  current: ClockTicket & {
    status: string;
    resolutionCode?: string | null;
    resolutionNote?: string | null;
  },
  value: string,
  now: Date = new Date(),
  calendar: BusinessCalendarLike | null = null,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const wasPending = current.status === "PENDING" || current.status === "ON_HOLD";
  const willPending = value === "PENDING" || value === "ON_HOLD";

  if (willPending && !wasPending) Object.assign(patch, pauseData(current, now));
  let effResolveDueAt = current.resolveDueAt;
  if (!willPending && wasPending) {
    const resumed = resumeData(current, now, calendar);
    Object.assign(patch, resumed);
    effResolveDueAt = resumed.resolveDueAt ?? current.resolveDueAt;
  }

  if (value === "RESOLVED") {
    patch.resolvedAt = now;
    patch.resolveBreached = effResolveDueAt ? now > effResolveDueAt : false;
  }
  if (value === "CLOSED") patch.closedAt = now;
  if (value === "OPEN" || value === "NEW") {
    patch.resolvedAt = null;
    patch.closedAt = null;
    patch.resolutionCode = null;
    patch.resolutionNote = null;
    patch.resolveBreached = false;
  }
  // Leaving a pending state clears its reason.
  if (!willPending) {
    patch.pendingReason = null;
    patch.pendingNote = null;
  }
  return patch;
}

const AT_RISK_FRACTION = 0.2; // last 20% of the window → "at risk"

/**
 * Live SLA state for display. `resolvedAt`/status decide terminal states.
 *
 * `calendar` (optional): when provided (from `loadBusinessCalendar`), the
 * at-risk/breach thresholds are measured in BUSINESS time — elapsed working ms
 * since `createdAt` vs the resolve target's business budget — instead of raw
 * wall-clock. Without it the original 24/7 comparison runs.
 */
export function slaSnapshot(
  ticket: ClockTicket & {
    status: string;
    resolvedAt: Date | null;
    createdAt: Date;
    resolveBreached: boolean;
  },
  now: Date = new Date(),
  calendar: BusinessCalendarLike | null = null,
): { state: SlaState; dueAt: Date | null } {
  const dueAt = ticket.resolveDueAt ?? ticket.dueAt;
  if (!dueAt) return { state: "NONE", dueAt: null };

  if (ticket.resolvedAt || ["RESOLVED", "CLOSED"].includes(ticket.status)) {
    return { state: ticket.resolveBreached ? "BREACHED" : "MET", dueAt };
  }
  if (ticket.pendingSince || ["PENDING", "ON_HOLD"].includes(ticket.status)) {
    return { state: "PAUSED", dueAt };
  }

  if (calendar) {
    // Business-hours mode: compare elapsed WORKING time to the working budget.
    // The budget is the working span from createdAt to the resolve deadline; the
    // deadline already carries any business-time pause shift from resumeData,
    // and elapsed working time contains the same pause span — the two cancel,
    // so no extra pausedMs correction is needed here (subtracting it would
    // double-count the pause and breach early).
    const budget = elapsedBusinessMs(ticket.createdAt, dueAt, calendar);
    const elapsed = elapsedBusinessMs(ticket.createdAt, now, calendar);
    if (budget <= 0) return now > dueAt ? { state: "BREACHED", dueAt } : { state: "ON_TRACK", dueAt };
    if (elapsed >= budget) return { state: "BREACHED", dueAt };
    const remaining = budget - elapsed;
    if (remaining <= budget * AT_RISK_FRACTION) return { state: "AT_RISK", dueAt };
    return { state: "ON_TRACK", dueAt };
  }

  // Wall-clock comparison (no business calendar).
  if (now > dueAt) return { state: "BREACHED", dueAt };

  // Exclude already-banked paused time from the window so "at risk" reflects the
  // true active-time budget, not wall-clock inflated by past pauses.
  const total = dueAt.getTime() - ticket.createdAt.getTime() - ticket.pausedMs;
  const remaining = dueAt.getTime() - now.getTime();
  if (total > 0 && remaining <= total * AT_RISK_FRACTION) return { state: "AT_RISK", dueAt };
  return { state: "ON_TRACK", dueAt };
}

/**
 * SLA elapsed-percent for escalation: how far through the resolve budget the
 * ticket is, 0..100+ (can exceed 100 once breached). Business-aware when a
 * calendar is supplied. Returns null when there's no deadline to measure.
 */
export function slaElapsedPercent(
  ticket: ClockTicket & { createdAt: Date },
  now: Date = new Date(),
  calendar: BusinessCalendarLike | null = null,
): number | null {
  const dueAt = ticket.resolveDueAt ?? ticket.dueAt;
  if (!dueAt) return null;
  if (calendar) {
    // Business mode: budget/elapsed both span the same pause shift (see
    // slaSnapshot) — no pausedMs correction to avoid double-counting.
    const budget = elapsedBusinessMs(ticket.createdAt, dueAt, calendar);
    if (budget <= 0) return now >= dueAt ? 100 : 0;
    const elapsed = elapsedBusinessMs(ticket.createdAt, now, calendar);
    return (elapsed / budget) * 100;
  }
  const budget = dueAt.getTime() - ticket.createdAt.getTime() - ticket.pausedMs;
  if (budget <= 0) return now >= dueAt ? 100 : 0;
  const elapsed = now.getTime() - ticket.createdAt.getTime() - ticket.pausedMs;
  return (elapsed / budget) * 100;
}
