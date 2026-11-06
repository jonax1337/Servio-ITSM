/** Pure decision rules for the SLA nudge tick (lib/ticks/sla-nudges.ts). */

import { ticketRef } from "@/lib/constants";

export const DEFAULT_NUDGE_PERCENT = 75;

const MIN_NUDGE_PERCENT = 1;
const MAX_NUDGE_PERCENT = 100;

const PAUSED_STATUSES: readonly string[] = ["PENDING", "ON_HOLD"];

/** The configured threshold, forced into 1..100 so a typo can neither fire instantly nor never. */
export function normalizeNudgePercent(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_NUDGE_PERCENT;
  return Math.min(MAX_NUDGE_PERCENT, Math.max(MIN_NUDGE_PERCENT, raw));
}

export type NudgeCandidate = {
  status: string;
  resolvedAt: Date | null;
  pendingSince: Date | null;
  assigneeId: string | null;
  slaNudgedAt: Date | null;
};

function isPaused(ticket: Pick<NudgeCandidate, "status" | "pendingSince">): boolean {
  return ticket.pendingSince !== null || PAUSED_STATUSES.includes(ticket.status);
}

/**
 * Whether the assignee should be nudged now. `elapsedPercent` is the resolve-SLA share used up so
 * far (business-calendar aware, see slaElapsedPercent), null when the ticket has no deadline.
 * Nobody is nudged for a paused or finished ticket, a ticket without an assignee (it is nudged once
 * someone owns it) or one that was nudged before.
 */
export function shouldNudge(ticket: NudgeCandidate, elapsedPercent: number | null, thresholdPercent: number): boolean {
  if (ticket.slaNudgedAt || ticket.resolvedAt || !ticket.assigneeId) return false;
  if (isPaused(ticket) || elapsedPercent === null) return false;
  return elapsedPercent >= thresholdPercent;
}

export type NudgeMessage = { title: string; body: string };

/** The in-app notification text; an already overdue ticket says so instead of quoting a percentage. */
export function nudgeMessage(
  ticket: { id: number; prefix: string; title: string },
  elapsedPercent: number,
): NudgeMessage {
  const ref = ticketRef(ticket.id, ticket.prefix);
  const overdue = elapsedPercent >= 100;
  return {
    title: overdue ? `${ref} is past its SLA` : `${ref} is running out of SLA time`,
    body: overdue
      ? `${ticket.title}: the resolve deadline has passed.`
      : `${ticket.title}: ${Math.floor(elapsedPercent)}% of the resolve time is used.`,
  };
}
