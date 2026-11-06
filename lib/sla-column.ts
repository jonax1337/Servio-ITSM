import type { SlaClock, SlaClockState } from "@/lib/sla-views";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SHORT_HOURS_WITH_MINUTES = 10;

/** A span as short as a table cell wants it: "45m", "2h 10m", "7h", "3d". Never below a minute. */
export function compactDuration(ms: number): string {
  const span = Math.max(ms, MINUTE_MS);
  if (span >= 2 * DAY_MS) return `${Math.floor(span / DAY_MS)}d`;
  if (span >= HOUR_MS) {
    const hours = Math.floor(span / HOUR_MS);
    const minutes = Math.floor((span % HOUR_MS) / MINUTE_MS);
    return hours < SHORT_HOURS_WITH_MINUTES && minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${Math.floor(span / MINUTE_MS)}m`;
}

/** What the SLA column shows for a ticket: the state, and how long is left or overdue. Empty for a ticket without a clock. */
export type SlaCell = { state: SlaClockState; detail: string | null };

const DETAIL: Record<SlaClockState, (remainingMs: number) => string | null> = {
  BREACHED: (remaining) => `overdue ${compactDuration(-remaining)}`,
  AT_RISK: (remaining) => `${compactDuration(remaining)} left`,
  ON_TRACK: (remaining) => `${compactDuration(remaining)} left`,
  PAUSED: () => null,
};

export function slaCell(clock: SlaClock | null, now: Date = new Date()): SlaCell | null {
  return clock ? { state: clock.state, detail: DETAIL[clock.state](clock.dueAt.getTime() - now.getTime()) } : null;
}
