import type { EntityTab } from "@/lib/entity-tabs";

/** Pure rules for the approvals inbox and for who may decide a change approval. */

// ── Four-eyes rule for changes ───────────────────────────────────────────────

export const CHANGE_SELF_APPROVAL_ERROR =
  "You can't approve a change you requested or own. Another approver has to decide it.";

/**
 * Why `userId` may not decide an approval on this change, or null when nothing speaks against it.
 * The person who raised or owns a change never approves it — not even as an admin.
 */
export function changeSelfApprovalError(
  change: { createdById: string | null; assigneeId: string | null },
  userId: string,
): string | null {
  return change.createdById === userId || change.assigneeId === userId ? CHANGE_SELF_APPROVAL_ERROR : null;
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
