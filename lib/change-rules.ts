/** Pure business rules for changes, shared by the server actions, the UI and their tests. */

import { format } from "date-fns";
import {
  CHANGE_OUTCOMES,
  CHANGE_STATUSES,
  CHANGE_STATUS_META,
  CHANGE_TYPES,
  IMPACT_URGENCY,
  PRIORITIES,
  RISKS,
} from "@/lib/constants";
import type { ChangeSelfApprovalMode } from "@/lib/approval-rules";

export const statusLabel = (status: string) => CHANGE_STATUS_META[status]?.label ?? status;

// ── Planned window ───────────────────────────────────────────────────────────

export const WINDOW_ORDER_ERROR = "Planned end must be after the planned start.";

export type PlannedWindow = { start: Date | null; end: Date | null };

/** Error message when the window is inverted or empty; null when valid or incomplete. */
export function plannedWindowError(start: Date | null, end: Date | null): string | null {
  if (!start || !end) return null;
  return end.getTime() > start.getTime() ? null : WINDOW_ORDER_ERROR;
}

/** Once the CAB has approved, moving the window is a reschedule and needs a reason. */
const RESCHEDULE_STATUSES: readonly string[] = ["APPROVED", "SCHEDULED"];

/** Statuses in which the planned window may change: before the CAB decides, or as a reasoned reschedule. */
const WINDOW_EDITABLE_STATUSES: readonly string[] = ["DRAFT", "REJECTED", ...RESCHEDULE_STATUSES];

export function isWindowEditable(status: string): boolean {
  return WINDOW_EDITABLE_STATUSES.includes(status);
}

export function requiresRescheduleReason(status: string): boolean {
  return RESCHEDULE_STATUSES.includes(status);
}

const sameInstant = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

export function windowChanged(current: PlannedWindow, next: PlannedWindow): boolean {
  return !sameInstant(current.start, next.start) || !sameInstant(current.end, next.end);
}

const DISPLAY_DATE = "PP p";

export function formatPlannedWindow({ start, end }: PlannedWindow): string {
  if (start && end) return `${format(start, DISPLAY_DATE)} – ${format(end, DISPLAY_DATE)}`;
  if (start) return `from ${format(start, DISPLAY_DATE)}`;
  if (end) return `until ${format(end, DISPLAY_DATE)}`;
  return "not set";
}

/** Why a window edit must be refused in this status, or null when it may go ahead. */
export function rescheduleError(
  status: string,
  current: PlannedWindow,
  next: PlannedWindow,
  reason: string | null,
): string | null {
  if (!requiresRescheduleReason(status) || !windowChanged(current, next)) return null;
  if (!next.start || !next.end) return "An approved change must keep its planned window; move the dates instead of clearing them.";
  if (!reason?.trim()) return "Add a short reason to reschedule an approved change.";
  return null;
}

export function rescheduleComment(current: PlannedWindow, next: PlannedWindow, reason: string): string {
  return `Window rescheduled from ${formatPlannedWindow(current)} to ${formatPlannedWindow(next)}: ${reason.trim()}`;
}

export function windowLockedMessage(status: string): string {
  return `The planned window can't be changed while the change is ${statusLabel(status).toLowerCase()}.`;
}

// ── Submit prerequisites ─────────────────────────────────────────────────────

export type SubmitCandidate = {
  implementationPlan: string | null;
  rollbackPlan: string | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
};

export type SubmitField = "implementationPlan" | "rollbackPlan" | "plannedWindow";

/** What each prerequisite is called and where it lives on the change's Planning tab (the element id). */
const SUBMIT_FIELD_META: Record<SubmitField, { label: string; anchor: string }> = {
  implementationPlan: { label: "an implementation plan", anchor: "implementation-plan" },
  rollbackPlan: { label: "a rollback plan", anchor: "rollback-plan" },
  plannedWindow: { label: "a planned window (start and end)", anchor: "planned-window" },
};

export type SubmitBlocker = { field: SubmitField; label: string; href: string };

/**
 * What is still missing before a change may go to approval, each with a link to the field
 * on the Planning tab. A pre-approved standard change is exempt: its procedure lives in the
 * template it was created from.
 */
export function submitBlockerDetails(change: SubmitCandidate & { id: number }, preApproved: boolean): SubmitBlocker[] {
  if (preApproved) return [];
  const missing: SubmitField[] = [];
  if (!change.implementationPlan?.trim()) missing.push("implementationPlan");
  if (!change.rollbackPlan?.trim()) missing.push("rollbackPlan");
  if (!change.plannedStart || !change.plannedEnd) missing.push("plannedWindow");
  return missing.map((field) => ({
    field,
    label: SUBMIT_FIELD_META[field].label,
    href: `/changes/${change.id}?tab=planning#${SUBMIT_FIELD_META[field].anchor}`,
  }));
}

/** The element id of a prerequisite's field on the Planning tab (the target of its link). */
export const submitFieldAnchor = (field: SubmitField) => SUBMIT_FIELD_META[field].anchor;

/** The prerequisites' names only, for badges and the next-step hint. */
export function submitBlockers(change: SubmitCandidate, preApproved: boolean): string[] {
  return submitBlockerDetails({ ...change, id: 0 }, preApproved).map((b) => b.label);
}

export function submitBlockedMessage(missing: string[]): string {
  const list = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}` : missing[0];
  return `Cannot submit for approval: add ${list} first.`;
}

// ── Standard changes ─────────────────────────────────────────────────────────
// A standard change is pre-authorized by the approved template it was created from;
// nothing else makes a change STANDARD, and editing its procedure takes the pre-approval away.

export const STANDARD_NEEDS_TEMPLATE_MESSAGE = "Standard changes are created from an approved template.";

export const EDITED_AWAY_FROM_TEMPLATE_COMMENT = "Edited away from the standard template — needs CAB approval.";

/** Types a change can be given by hand; STANDARD is reserved for templates. */
export const MANUAL_CHANGE_TYPES = CHANGE_TYPES.filter((type) => type !== "STANDARD");

/** Why a change may not be given this type, or null. A change that already is STANDARD keeps it. */
export function standardTypeError(nextType: string, currentType: string | null): string | null {
  return nextType === "STANDARD" && currentType !== "STANDARD" ? STANDARD_NEEDS_TEMPLATE_MESSAGE : null;
}

type TemplatedChange = { type: string; templateId: string | null };

/** A STANDARD change that traces back to a template (older STANDARD changes without one carry no pre-approval). */
export function isTemplatedStandard(change: TemplatedChange): boolean {
  return change.type === "STANDARD" && change.templateId !== null;
}

/** Submitting auto-approves only when the change's template is still active and itself STANDARD. */
export function preApprovalApplies(change: TemplatedChange, template: { type: string; isActive: boolean } | null): boolean {
  return isTemplatedStandard(change) && template !== null && template.isActive && template.type === "STANDARD";
}

/** The fields a template fixes for its changes. */
const STANDARD_PROCEDURE_FIELDS: readonly string[] = ["implementationPlan", "rollbackPlan", "risk", "impact"];

/** Whether saving `next` into `field` (currently `current`) moves a change away from its template's approved procedure. */
export function leavesStandardProcedure(field: string, next: string | null, current: string | null): boolean {
  if (field === "type") return next !== "STANDARD";
  return STANDARD_PROCEDURE_FIELDS.includes(field) && (next ?? "") !== (current ?? "");
}

/** Statuses a pre-approved change reaches before its work starts. */
const PRE_APPROVED_STATUSES: readonly string[] = ["APPROVED", "SCHEDULED"];

export type StandardDemotion = { backToDraft: boolean };

/**
 * What an edit that leaves the template's procedure does to the change: null when it is not a
 * templated standard change, otherwise it becomes NORMAL, and goes back to DRAFT when its
 * pre-approval was granted but the work has not started.
 */
export function standardDemotion(change: TemplatedChange & { status: string }): StandardDemotion | null {
  if (!isTemplatedStandard(change)) return null;
  return { backToDraft: PRE_APPROVED_STATUSES.includes(change.status) };
}

// ── CAB board ────────────────────────────────────────────────────────────────

/** The board may be curated while it is being assembled (draft) or is live (approval). */
const BOARD_SEATING_STATUSES: readonly string[] = ["DRAFT", "APPROVAL"];

export function canSeatApprovers(status: string): boolean {
  return BOARD_SEATING_STATUSES.includes(status);
}

/** An expedited emergency board (ECAB) never exceeds this many seats, manual ones included. */
const EMERGENCY_BOARD_SIZE = 2;

export function boardSizeLimit(type: string): number {
  return type === "EMERGENCY" ? EMERGENCY_BOARD_SIZE : Number.POSITIVE_INFINITY;
}

/** Auto-selected approvers to add on top of the seats already filled, without duplicates and within the board size limit. */
export function approversToSeat(selected: string[], alreadySeated: string[], limit = Number.POSITIVE_INFINITY): string[] {
  const seated = new Set(alreadySeated);
  const room = Math.max(0, limit - seated.size);
  return selected.filter((id) => !seated.has(id)).slice(0, room);
}

export type SeatedApprover = { approvalId: string; approverId: string; role: string; isActive: boolean };

/**
 * Seats added while drafting that can no longer sit on the board: the approver became the
 * change's owner or creator (separation of duties), was deactivated, or lost the role the
 * change's risk demands.
 */
export function invalidSeats(
  seats: SeatedApprover[],
  change: { assigneeId: string | null; createdById: string | null },
  eligibleRoles: readonly string[],
): SeatedApprover[] {
  return seats.filter(
    (seat) =>
      seat.approverId === change.assigneeId ||
      seat.approverId === change.createdById ||
      !seat.isActive ||
      !eligibleRoles.includes(seat.role),
  );
}

export type SelfSeatCandidate = { id: string; role: string; isActive: boolean };

export type BoardSeatingInput = {
  mode: ChangeSelfApprovalMode;
  /** Auto-selected approvers (owner and requester already excluded). */
  selected: string[];
  /** Seats kept from drafting. */
  kept: string[];
  /** The change's owner and requester, owner first. */
  parties: SelfSeatCandidate[];
  eligibleRoles: readonly string[];
  limit?: number;
};

/**
 * Who joins the board at submit. Auto-selected approvers top up the kept seats within the size
 * limit, exactly as without self-approval. The owner and requester join only as far as the mode
 * allows and their role may approve the change's risk:
 * - WHEN_NO_OTHER_APPROVER: only when the board would otherwise be empty;
 * - ALWAYS: always, ahead of the auto-selected approvers, so they also fit an emergency board.
 */
export function seatBoard({
  mode, selected, kept, parties, eligibleRoles, limit = Number.POSITIVE_INFINITY,
}: BoardSeatingInput): { autoIds: string[]; selfIds: string[] } {
  const eligibleParties = [
    ...new Set(parties.filter((p) => p.isActive && eligibleRoles.includes(p.role)).map((p) => p.id)),
  ];
  if (mode === "ALWAYS") {
    const selfIds = approversToSeat(eligibleParties, kept, limit);
    return { selfIds, autoIds: approversToSeat(selected, [...kept, ...selfIds], limit) };
  }
  const autoIds = approversToSeat(selected, kept, limit);
  const boardEmpty = kept.length + autoIds.length === 0;
  const selfIds = mode === "WHEN_NO_OTHER_APPROVER" && boardEmpty ? approversToSeat(eligibleParties, [], limit) : [];
  return { autoIds, selfIds };
}

/** Once the board has decided (or the change is called off), approvers who never answered have nothing left to decide. */
const BOARD_SETTLED_STATUSES: readonly string[] = ["APPROVED", "REJECTED", "CANCELLED"];

export function settlesApprovalBoard(status: string): boolean {
  return BOARD_SETTLED_STATUSES.includes(status);
}

// ── Lifecycle moves ──────────────────────────────────────────────────────────

/** Statuses set only by the approval workflow; a manual edit would bypass separation of duties. */
const APPROVAL_FLOW_STATUSES: readonly string[] = ["APPROVAL", "APPROVED"];

export function manualStatusError(to: string): string | null {
  return APPROVAL_FLOW_STATUSES.includes(to)
    ? `${statusLabel(to)} is set by the approval workflow. Use "Submit for approval" instead.`
    : null;
}

/** A closed or cancelled change is a finished record: comments and links stay open, everything else is read-only. */
const LOCKED_STATUSES: readonly string[] = ["CLOSED", "CANCELLED"];

export function isChangeLocked(status: string): boolean {
  return LOCKED_STATUSES.includes(status);
}

export function changeLockedMessage(status: string): string {
  return `This change is ${statusLabel(status).toLowerCase()} and can no longer be edited. Comments and links can still be added.`;
}

/** Moving into these statuses records how the implementation went. */
const CLOSURE_STATUSES: readonly string[] = ["CLOSED", "FAILED"];
const FAILURE_OUTCOMES: readonly string[] = ["FAILED", "ROLLED_BACK"];

export function isClosureStatus(status: string): boolean {
  return CLOSURE_STATUSES.includes(status);
}

export function allowedOutcomes(toStatus: string): readonly string[] {
  return toStatus === "FAILED" ? FAILURE_OUTCOMES : CHANGE_OUTCOMES;
}

export type ClosureInput = {
  toStatus: string;
  type: string;
  outcome: string | null;
  notes: string | null;
};

/** Why a move into CLOSED/FAILED lacks its outcome or post-implementation review; null when complete. */
export function closureError({ toStatus, type, outcome, notes }: ClosureInput): string | null {
  if (!isClosureStatus(toStatus)) return null;
  if (!outcome) return "Choose an outcome before closing the change.";
  if (!allowedOutcomes(toStatus).includes(outcome)) {
    return toStatus === "FAILED"
      ? "A failed change needs the outcome Failed or Rolled back."
      : "Choose a valid outcome.";
  }
  if (!notes?.trim()) {
    return type === "EMERGENCY"
      ? "Emergency changes need a post-implementation review (closure notes) first."
      : "Add closure notes (post-implementation review or lessons learned).";
  }
  return null;
}

export function cancelReasonError(reason: string | null): string | null {
  return reason?.trim() ? null : "Give a reason for cancelling the change.";
}

/** The real end of the implementation is stamped when work stops, not only at closure. */
const WORK_ENDED_STATUSES: readonly string[] = ["REVIEW", "FAILED", "CLOSED"];

export function shouldStampActualEnd(toStatus: string, actualEnd: Date | null): boolean {
  return !actualEnd && WORK_ENDED_STATUSES.includes(toStatus);
}

// ── Field values ─────────────────────────────────────────────────────────────

const ENUM_FIELD_VALUES: Record<string, readonly string[]> = {
  status: CHANGE_STATUSES,
  type: CHANGE_TYPES,
  risk: RISKS,
  priority: PRIORITIES,
  impact: IMPACT_URGENCY,
};

/** Error for a value outside the field's enum; null for valid values and for fields that are not enums. */
export function fieldValueError(field: string, value: string): string | null {
  const allowed = ENUM_FIELD_VALUES[field];
  if (!allowed || allowed.includes(value)) return null;
  return `"${value}" is not a valid ${field}. Allowed: ${allowed.join(", ")}.`;
}
