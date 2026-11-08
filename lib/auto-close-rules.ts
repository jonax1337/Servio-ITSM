/**
 * Pure rules for closing resolved tickets automatically (Settings › Tickets,
 * AppSetting TICKET_AUTO_CLOSE_DAYS). The tick in lib/ticks/auto-close.ts does the I/O.
 */

export const TICKET_AUTO_CLOSE_DAYS_SETTING = "TICKET_AUTO_CLOSE_DAYS";

/** Upper bound of the setting: ten years is "never" for every practical purpose. */
export const MAX_AUTO_CLOSE_DAYS = 3650;

const DAY_MS = 86_400_000;

export const AUTO_CLOSE_DAYS_ERROR = `Enter a whole number of days between 0 and ${MAX_AUTO_CLOSE_DAYS} (0 turns automatic closing off).`;

/** The stored value as whole days; anything unusable (negative, NaN) means off (0). */
export function normalizeAutoCloseDays(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_AUTO_CLOSE_DAYS, Math.floor(value));
}

/** Validate the Settings form input: a whole number 0..MAX, or an error message. */
export function parseAutoCloseDaysInput(raw: string): { days: number } | { error: string } {
  const text = raw.trim();
  if (text === "") return { days: 0 };
  if (!/^\d+$/.test(text)) return { error: AUTO_CLOSE_DAYS_ERROR };
  const days = Number(text);
  if (days > MAX_AUTO_CLOSE_DAYS) return { error: AUTO_CLOSE_DAYS_ERROR };
  return { days };
}

/** Tickets resolved at or before this instant are due; null when automatic closing is off. */
export function autoCloseCutoff(now: Date, days: number): Date | null {
  if (days <= 0) return null;
  return new Date(now.getTime() - days * DAY_MS);
}

/** The audit summary of an automatic close (stored English, like every audit summary). */
export function autoCloseAuditSummary(days: number): string {
  return `Closed automatically after ${days} ${days === 1 ? "day" : "days"} in Resolved`;
}
