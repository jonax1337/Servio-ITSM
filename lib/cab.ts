import { db } from "@/lib/db";
import { CAB_APPROVAL_RULES } from "@/lib/constants";
import { MAY_JOIN_APPROVAL_BOARD_WHERE, mayJoinApprovalBoard } from "@/lib/service-accounts";

export type ChangeForCab = {
  id: number;
  type: string;
  risk: string;
  assigneeId: string | null;
  createdById: string | null;
};

export type CabApprovalRule = (typeof CAB_APPROVAL_RULES)[number];

/** Coerce a stored (String-backed) approvalRule into a known rule, defaulting to UNANIMOUS. */
export function normalizeCabRule(rule: string | null | undefined): CabApprovalRule {
  return (CAB_APPROVAL_RULES as readonly string[]).includes(rule ?? "")
    ? (rule as CabApprovalRule)
    : "UNANIMOUS";
}

/**
 * Compute the CAB (Change Advisory Board) for a change at submit time — a pure
 * query, no membership table. Eligible approvers are active MANAGER/ADMIN users
 * whose account may join a board (not a service account, switch on),
 * never the change owner OR its creator (separation of duties). HIGH-risk
 * changes require ADMIN. NORMAL = the full eligible board; EMERGENCY = an
 * expedited ECAB (≤2, ADMINs first).
 *
 * Future options (not built): a group-scoped CAB via GroupMember, or a
 * Change.pirRequired column instead of the internal-comment PIR marker.
 */
export async function selectApprovers(change: ChangeForCab): Promise<string[]> {
  const roles = change.risk === "HIGH" ? ["ADMIN"] : ["ADMIN", "MANAGER"];
  // SoD: exclude BOTH the owner (assignee) and the creator — neither may sit on
  // the board that reviews their own change, even when they are an ADMIN.
  const excluded = [change.assigneeId, change.createdById].filter(
    (v): v is string => !!v,
  );
  const candidates = await db.user.findMany({
    where: {
      isActive: true,
      ...MAY_JOIN_APPROVAL_BOARD_WHERE,
      role: { in: roles },
      id: excluded.length ? { notIn: excluded } : undefined,
    },
    orderBy: { role: "asc" }, // "ADMIN" < "MANAGER" alphabetically → admins first
    select: { id: true },
  });
  const ids = candidates.map((u) => u.id);
  // EMERGENCY: expedited board of at most two (admins prioritised by the order above).
  return change.type === "EMERGENCY" ? ids.slice(0, 2) : ids;
}

// ── CAB decision rule evaluation ─────────────────────────────────────────────

export type CabTally = {
  seated: number;
  approved: number;
  rejected: number;
  pending: number;
  /** The minimum number of APPROVED rows required to satisfy the rule. */
  required: number;
  rule: CabApprovalRule;
  /** True once `approved >= required` (and at least one seat exists). */
  satisfied: boolean;
};

/**
 * Evaluate a CAB board against its rule. This is the single source of truth for
 * "how many approvals does this change need, and does it have them yet?" — used
 * both by the server actions (to flip a change to APPROVED) and by the UI (to
 * render approval progress).
 *
 * - UNANIMOUS → every seated approver must approve.
 * - QUORUM    → at least `threshold` approvals (clamped to the seat count; a
 *               missing/invalid threshold falls back to unanimity).
 * - PERCENT   → at least `ceil(seated * threshold%)` approvals (threshold is a
 *               percentage 1–100; a missing/invalid value falls back to 100%).
 *
 * An empty board is NEVER satisfied — a change can't auto-approve with no seat.
 */
export function evaluateCab(
  statuses: string[],
  rule: string | null | undefined,
  threshold: number | null | undefined,
): CabTally {
  const seated = statuses.length;
  const approved = statuses.filter((s) => s === "APPROVED").length;
  const rejected = statuses.filter((s) => s === "REJECTED").length;
  const pending = statuses.filter((s) => s === "PENDING").length;
  const r = normalizeCabRule(rule);

  let required: number;
  if (seated === 0) {
    required = Number.POSITIVE_INFINITY; // impossible to satisfy → never auto-approve
  } else if (r === "QUORUM") {
    // At least N, but never more than the number of seats.
    const n = threshold != null && threshold > 0 ? Math.floor(threshold) : seated;
    required = Math.min(n, seated);
  } else if (r === "PERCENT") {
    const pct = threshold != null && threshold > 0 ? Math.min(threshold, 100) : 100;
    required = Math.max(1, Math.ceil((seated * pct) / 100));
  } else {
    required = seated; // UNANIMOUS
  }

  return {
    seated,
    approved,
    rejected,
    pending,
    required: Number.isFinite(required) ? required : 0,
    rule: r,
    satisfied: seated > 0 && approved >= required,
  };
}

/** Roles that may sit on the CAB for a change of this risk. */
export function approverRolesForRisk(risk: string): string[] {
  return risk === "HIGH" ? ["ADMIN"] : ["ADMIN", "MANAGER"];
}

/** Whether a user is eligible to be seated as an approver for a change's risk. */
export async function isEligibleApprover(userId: string, risk: string): Promise<boolean> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true, isServiceAccount: true, canApproveChanges: true },
  });
  return !!u && u.isActive && mayJoinApprovalBoard(u) && approverRolesForRisk(risk).includes(u.role);
}
