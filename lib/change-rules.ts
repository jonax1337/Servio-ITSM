/** Pure business rules for changes, shared by the server actions and their tests. */

export const WINDOW_ORDER_ERROR = "Planned end must be after the planned start.";

/** Error message when the window is inverted or empty; null when valid or incomplete. */
export function plannedWindowError(start: Date | null, end: Date | null): string | null {
  if (!start || !end) return null;
  return end.getTime() > start.getTime() ? null : WINDOW_ORDER_ERROR;
}

/** Statuses in which the planned window may still change: before the CAB has seated or decided. */
const WINDOW_EDITABLE_STATUSES: readonly string[] = ["DRAFT", "SUBMITTED", "REJECTED"];

export function isWindowEditable(status: string): boolean {
  return WINDOW_EDITABLE_STATUSES.includes(status);
}

export type SubmitCandidate = {
  type: string;
  implementationPlan: string | null;
  rollbackPlan: string | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
};

/**
 * What is still missing before a change may go to approval. STANDARD changes are
 * pre-authorized (no CAB), so they are exempt — their procedure lives in the template.
 */
export function submitBlockers(change: SubmitCandidate): string[] {
  if (change.type === "STANDARD") return [];
  const missing: string[] = [];
  if (!change.implementationPlan?.trim()) missing.push("an implementation plan");
  if (!change.rollbackPlan?.trim()) missing.push("a rollback plan");
  if (!change.plannedStart || !change.plannedEnd) missing.push("a planned window (start and end)");
  return missing;
}

export function submitBlockedMessage(missing: string[]): string {
  const list = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}` : missing[0];
  return `Cannot submit for approval: add ${list} first.`;
}
