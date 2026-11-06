/**
 * Pure business rules for contracts and software licenses: renewal-notice
 * windows, the at-most-once reminder decision, and license compliance
 * (assignments used vs seats). No I/O, so the scheduler tick, the pages and
 * Sable all share one definition.
 */

const DAY_MS = 86_400_000;

export const DEFAULT_RENEWAL_NOTICE_DAYS = 30;

/** Contract end dates are calendar days: a contract ending today is still in force today. */
function startOfUtcDay(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS) * DAY_MS;
}

/** Whole calendar days from `now` to `date` (UTC): 0 = today, negative = in the past. */
export function daysUntil(date: Date, now: Date): number {
  return Math.round((startOfUtcDay(date) - startOfUtcDay(now)) / DAY_MS);
}

export type ContractExpiryState = "NONE" | "OK" | "EXPIRING" | "EXPIRED";

export type ContractTimeline = {
  status: string;
  endDate: Date | null;
  renewalNoticeDays: number;
};

/**
 * Where a contract stands relative to its end date. Drafts and terminated
 * contracts have no expiry to watch; a stored EXPIRED status wins over the dates.
 */
export function contractExpiry(contract: ContractTimeline, now: Date): ContractExpiryState {
  if (!contract.endDate || contract.status === "DRAFT" || contract.status === "TERMINATED") return "NONE";
  if (contract.status === "EXPIRED") return "EXPIRED";
  const days = daysUntil(contract.endDate, now);
  if (days < 0) return "EXPIRED";
  return days <= contract.renewalNoticeDays ? "EXPIRING" : "OK";
}

export type ExpiryNotice = { tone: "warning" | "danger"; text: string };

/** The sentence shown on a contract that needs attention, or null while it is fine. */
export function expiryNotice(
  contract: ContractTimeline & { autoRenew: boolean },
  now: Date,
): ExpiryNotice | null {
  const expiry = contractExpiry(contract, now);
  const endDate = contract.endDate;
  if (!endDate || (expiry !== "EXPIRING" && expiry !== "EXPIRED")) return null;
  if (expiry === "EXPIRED") {
    const ended = daysUntil(endDate, now) < 0 ? `This contract ended on ${formatDay(endDate)}.` : "This contract is marked as expired.";
    return { tone: "danger", text: `${ended} Move the end date to renew it, or set its status to Terminated.` };
  }
  const next = contract.autoRenew
    ? "It renews automatically unless you cancel in time."
    : "It lapses unless you renew it.";
  return { tone: "warning", text: `Ends on ${formatDay(endDate)}, inside its ${contract.renewalNoticeDays}-day notice period. ${next}` };
}

export type RenewalReminderCandidate =ContractTimeline & {
  ownerId: string | null;
  /** The endDate the reminder already fired for (Contract.renewalNotifiedFor). */
  renewalNotifiedFor: Date | null;
};

/**
 * Should the owner be reminded now? Only ACTIVE contracts with an owner, inside the
 * notice period, and at most once per `endDate`: moving the end date (a renewal)
 * re-arms the reminder because the stored marker no longer matches.
 */
export function renewalReminderDue(contract: RenewalReminderCandidate, now: Date): boolean {
  if (contract.status !== "ACTIVE" || !contract.ownerId || !contract.endDate) return false;
  if (contractExpiry(contract, now) !== "EXPIRING") return false;
  return contract.renewalNotifiedFor?.getTime() !== contract.endDate.getTime();
}

/** `YYYY-MM-DD`, the value format of a date input. */
export const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** A calendar day for display ("Nov 5, 2026"), read in UTC so it matches what the date input stored. */
export const formatDay = (date: Date) =>
  date.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });

/** Currency-neutral amount with two decimals: there is no org currency setting, so no symbol is invented. */
export const formatCost = (amount: number) =>
  amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Licenses only carry an expiry date, so they reuse the contract renewal window. */
export function licenseExpiry(expiresAt: Date | null, now: Date): ContractExpiryState {
  return contractExpiry({ status: "ACTIVE", endDate: expiresAt, renewalNoticeDays: DEFAULT_RENEWAL_NOTICE_DAYS }, now);
}

export function renewalReminderMessage(
  contract: { name: string; endDate: Date; autoRenew: boolean },
  now: Date,
): { title: string; body: string } {
  const days = daysUntil(contract.endDate, now);
  const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  const next = contract.autoRenew
    ? "It renews automatically unless you cancel in time."
    : "It will lapse unless you renew it.";
  return {
    title: `Contract "${contract.name}" ends ${when}`,
    body: `Ends ${isoDay(contract.endDate)}. ${next}`,
  };
}

export type LicenseComplianceState = "OK" | "FULL" | "OVER";

export type LicenseCompliance = {
  seats: number;
  used: number;
  free: number;
  overBy: number;
  state: LicenseComplianceState;
};

/** Compliance = assignments used vs seats purchased. */
export function licenseCompliance(seats: number, used: number): LicenseCompliance {
  const free = Math.max(0, seats - used);
  const overBy = Math.max(0, used - seats);
  const state: LicenseComplianceState = overBy > 0 ? "OVER" : free === 0 ? "FULL" : "OK";
  return { seats, used, free, overBy, state };
}

export type OverAllocationAction = "NOTIFY" | "REARM" | "NONE";

/**
 * What the tick does about a license: alert the owner the first time it is
 * over-allocated, clear the marker once it is compliant again so a later
 * overrun alerts again, otherwise nothing. Without an owner nobody can be
 * alerted, so the marker stays unset and the alert fires once an owner exists.
 */
export function overAllocationAction(
  compliance: LicenseCompliance,
  hasOwner: boolean,
  notifiedAt: Date | null,
): OverAllocationAction {
  if (compliance.state === "OVER") return hasOwner && !notifiedAt ? "NOTIFY" : "NONE";
  return notifiedAt ? "REARM" : "NONE";
}

export function overAllocationMessage(license: { name: string }, compliance: LicenseCompliance) {
  return {
    title: `License "${license.name}" is over-allocated`,
    body: `${compliance.used} seats assigned but only ${compliance.seats} purchased (${compliance.overBy} over).`,
  };
}

export const CONTRACT_END_BEFORE_START = "The end date can't be before the start date.";
export const ASSIGNMENT_NEEDS_TARGET = "Choose a user, an asset, or both.";
export const ASSIGNMENT_DUPLICATE = "That seat is already assigned.";

export function contractDateError(startDate: Date, endDate: Date | null): string | null {
  return endDate && endDate.getTime() < startDate.getTime() ? CONTRACT_END_BEFORE_START : null;
}

export type AssignmentTarget = { userId: string | null; assetId: string | null };

/** A seat goes to a user, an asset, or both, and the same pairing can't be assigned twice. */
export function assignmentError(candidate: AssignmentTarget, existing: readonly AssignmentTarget[]): string | null {
  if (!candidate.userId && !candidate.assetId) return ASSIGNMENT_NEEDS_TARGET;
  const duplicate = existing.some((e) => e.userId === candidate.userId && e.assetId === candidate.assetId);
  return duplicate ? ASSIGNMENT_DUPLICATE : null;
}
