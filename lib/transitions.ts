// Allowed status transitions. A move is permitted when target ∈ map[from],
// or it is a no-op (from === to), or `from` is unknown (fail-open on bad data).
// Manual status edits go through these guards; the Change approval flow sets
// APPROVED/REJECTED through its own audited path (decideApproval), not here.

export type TransitionMap = Record<string, readonly string[]>;

export const TICKET_TRANSITIONS: TransitionMap = {
  // Direct CLOSED/CANCELLED from active states is a legitimate agent shortcut
  // (resolution dialog), so both the dropdown and dialog paths agree.
  NEW: ["OPEN", "IN_PROGRESS", "PENDING", "ON_HOLD", "RESOLVED", "CLOSED", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "PENDING", "ON_HOLD", "RESOLVED", "CLOSED", "CANCELLED"],
  IN_PROGRESS: ["OPEN", "PENDING", "ON_HOLD", "RESOLVED", "CLOSED", "CANCELLED"],
  PENDING: ["OPEN", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED", "CANCELLED"],
  ON_HOLD: ["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED", "CANCELLED"],
  RESOLVED: ["CLOSED", "OPEN"], // reopen
  CLOSED: ["OPEN"], // reopen
  CANCELLED: ["OPEN"], // reopen
};

export const PROBLEM_TRANSITIONS: TransitionMap = {
  NEW: ["INVESTIGATING", "KNOWN_ERROR", "RESOLVED", "CLOSED"],
  INVESTIGATING: ["KNOWN_ERROR", "RESOLVED", "CLOSED", "NEW"],
  KNOWN_ERROR: ["RESOLVED", "CLOSED", "INVESTIGATING"],
  RESOLVED: ["CLOSED", "INVESTIGATING"], // reopen to investigating
  CLOSED: ["INVESTIGATING"], // reopen
};

export const CHANGE_TRANSITIONS: TransitionMap = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVAL", "DRAFT", "REJECTED"],
  // APPROVED is reachable ONLY via the CAB approval flow (decideApproval),
  // never a manual status edit — so it is deliberately absent here.
  APPROVAL: ["REJECTED", "DRAFT"],
  APPROVED: ["SCHEDULED", "IN_PROGRESS"],
  SCHEDULED: ["IN_PROGRESS", "APPROVED"],
  IN_PROGRESS: ["REVIEW", "FAILED"],
  REVIEW: ["CLOSED", "FAILED"],
  FAILED: ["REVIEW", "CLOSED"],
  REJECTED: ["DRAFT"],
  CLOSED: [],
};

/**
 * A catalog request whose approval is still PENDING may not be worked, paused or
 * fulfilled before the approver decides; agents can only cancel it. The approval
 * flow itself (decideApproval) moves it on and is not routed through here.
 */
export function approvalAllowsStatus(approvalState: string | null | undefined, to: string) {
  return approvalState !== "PENDING" || to === "CANCELLED";
}

export function canTransition(
  map: TransitionMap,
  from: string | null | undefined,
  to: string,
  failClosed = false,
) {
  if (!from || from === to) return true;
  const allowed = map[from];
  // Unknown/renamed `from`: tickets fail open (never freeze a record after a
  // migration); governed flows (Change) pass failClosed=true to reject instead.
  if (!allowed) return !failClosed;
  return allowed.includes(to);
}
