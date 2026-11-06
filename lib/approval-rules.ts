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
