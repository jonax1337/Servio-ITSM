import type { EntityTab } from "@/lib/entity-tabs";

/** Pure rules for the approvals inbox and for who may decide a change approval. */

// ── Four-eyes rule for changes ───────────────────────────────────────────────

export const CHANGE_SELF_APPROVAL_ERROR =
  "You can't approve a change you requested or own. Another approver has to decide it.";
export const SELF_APPROVAL_ROLE_ERROR =
  "Your role cannot self-approve a change of this risk. Another approver has to decide it.";
export const SELF_APPROVAL_COMMENT_ERROR =
  "A self-approval needs a comment that justifies deciding your own change.";

/**
 * Admin setting (Settings › Change management) for small teams that cannot staff a four-eyes review:
 * - OFF: the requester and owner never decide their own change (default).
 * - WHEN_NO_OTHER_APPROVER: they are seated only when nobody else is eligible for the board.
 * - ALWAYS: they are seated next to the board, and their own decision settles it on its own.
 */
export const CHANGE_SELF_APPROVAL_MODES = ["OFF", "WHEN_NO_OTHER_APPROVER", "ALWAYS"] as const;
export type ChangeSelfApprovalMode = (typeof CHANGE_SELF_APPROVAL_MODES)[number];

/** A stored mode, falling back to OFF for anything unknown so a typo never weakens the rule. */
export function parseSelfApprovalMode(value: string | null | undefined): ChangeSelfApprovalMode {
  return (CHANGE_SELF_APPROVAL_MODES as readonly string[]).includes(value ?? "")
    ? (value as ChangeSelfApprovalMode)
    : "OFF";
}

type ChangeParties = { createdById: string | null; assigneeId: string | null };

/** Deciding a change you requested (created) or own (are assigned to) is a self-approval. */
export function isChangeSelfApproval(change: ChangeParties, userId: string): boolean {
  return change.createdById === userId || change.assigneeId === userId;
}

/** What decides whether a self-approval may go ahead: the setting, whose seat it is, and the decider's role. */
export type SelfApprovalScope = {
  mode: ChangeSelfApprovalMode;
  /** The seat being decided: a self-approval is only ever on one's own seat. */
  approverId: string;
  role: string;
  /** Roles that may approve the change's risk (`approverRolesForRisk`). */
  eligibleRoles: readonly string[];
};

/**
 * Why `userId` may not decide an approval on this change, or null when nothing speaks against it.
 * The person who raised or owns a change never approves it — not even as an admin — unless an
 * admin allowed self-approval; even then only on their own seat (the admin override never
 * decides another approver's seat on one's own change) and only with a role the risk accepts.
 */
export function changeSelfApprovalError(
  change: ChangeParties,
  userId: string,
  selfApproval?: SelfApprovalScope,
): string | null {
  if (!isChangeSelfApproval(change, userId)) return null;
  if (!selfApproval || selfApproval.mode === "OFF" || selfApproval.approverId !== userId) {
    return CHANGE_SELF_APPROVAL_ERROR;
  }
  return selfApproval.eligibleRoles.includes(selfApproval.role) ? null : SELF_APPROVAL_ROLE_ERROR;
}

/** A self-approval is only recorded with a written justification. */
export function selfApprovalCommentError(comment: string | null | undefined): string | null {
  return comment && comment.trim() !== "" ? null : SELF_APPROVAL_COMMENT_ERROR;
}

/** In ALWAYS mode a self-decision settles the board by itself, whatever its approval rule. */
export function selfDecisionSettlesBoard(mode: ChangeSelfApprovalMode): boolean {
  return mode === "ALWAYS";
}

// ── Approvals inbox tabs ─────────────────────────────────────────────────────

/** The kinds of approval the inbox mixes: CAB change approvals, catalog service requests and ad-hoc sign-offs. */
export type ApprovalSection = "changes" | "requests" | "other";
export type ApprovalTab = "all" | ApprovalSection;

export const DEFAULT_APPROVAL_TAB: ApprovalTab = "all";

export function approvalTabs(counts: Record<ApprovalSection, number>): EntityTab<ApprovalTab>[] {
  return [
    { key: "all", label: "All", count: counts.changes + counts.requests + counts.other },
    { key: "changes", label: "Changes (CAB)", count: counts.changes },
    { key: "requests", label: "Service requests", count: counts.requests },
    { key: "other", label: "Other", count: counts.other },
  ];
}

/** Whether a section is listed under the active tab: "All" lists every section, the others only their own. */
export function tabShowsSection(tab: ApprovalTab, section: ApprovalSection): boolean {
  return tab === "all" || tab === section;
}

// ── Deciding a catalog request or an ad-hoc sign-off ─────────────────────────

export const REQUEST_SELF_APPROVAL_ERROR =
  "You can't approve a request you raised yourself. Another approver has to decide it.";
export const NOT_THE_APPROVER_ERROR = "Only the assigned approver can decide this request.";
export const ALREADY_DECIDED_ERROR = "This request has already been decided or withdrawn.";

/** Why a person may not decide an approval they requested themselves, or null. */
export function requestSelfApprovalError(requesterId: string | null, userId: string): string | null {
  return requesterId === userId ? REQUEST_SELF_APPROVAL_ERROR : null;
}

/**
 * Why `user` may not decide this catalog-request or sign-off approval, or null when they may.
 * Only a pending approval can be decided, only by its assigned approver (or an admin), and
 * never by the person who raised the request, not even as admin.
 */
export function decisionRefusal(
  approval: { status: string; approverId: string | null; requesterId: string | null },
  user: { id: string; role: string },
): string | null {
  if (approval.status !== "PENDING") return ALREADY_DECIDED_ERROR;
  if (approval.approverId !== user.id && user.role !== "ADMIN") return NOT_THE_APPROVER_ERROR;
  return requestSelfApprovalError(approval.requesterId, user.id);
}
