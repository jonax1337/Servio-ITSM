"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, type Role, requireAgentUser } from "@/lib/session";
import { apiActorUserId } from "@/lib/api-actor";
import { writeAudit, notify } from "@/lib/audit";
import { canTransitionConfigured } from "@/lib/workflow";
import { isGroupMember } from "@/lib/assignment";
import { selectApprovers, isEligibleApprover, evaluateCab, approverRolesForRisk } from "@/lib/cab";
import {
  changeSelfApprovalError,
  isChangeSelfApproval,
  selfApprovalCommentError,
  selfDecisionSettlesBoard,
  type ChangeSelfApprovalMode,
} from "@/lib/approval-rules";
import { getChangeSelfApprovalMode } from "@/lib/settings";
import { distinctIds } from "@/lib/utils";
import { AFFECTED_CI_SEARCH_LIMIT, affectedCiSearchWhere, attachableCiSearchWhere } from "@/lib/affected-ci-search";
import {
  boardSizeLimit,
  canSeatApprovers,
  cancelReasonError,
  changeLockedMessage,
  closureError,
  EDITED_AWAY_FROM_TEMPLATE_COMMENT,
  fieldValueError,
  invalidSeats,
  isChangeLocked,
  isClosureStatus,
  isTemplatedStandard,
  isWindowEditable,
  leavesStandardProcedure,
  manualStatusError,
  plannedWindowError,
  type PlannedWindow,
  preApprovalApplies,
  requiresRescheduleReason,
  rescheduleComment,
  rescheduleError,
  seatBoard,
  type SelfSeatCandidate,
  settlesApprovalBoard,
  shouldStampActualEnd,
  standardDemotion,
  standardTypeError,
  statusLabel,
  submitBlockedMessage,
  submitBlockers,
  windowChanged,
  windowLockedMessage,
} from "@/lib/change-rules";
import {
  freezeVerdict,
  type FreezeVerdict,
  type FreezeWindow,
} from "@/lib/change-schedule-rules";
import { assetIdsOfChange, freezeHitsForWindow, scopeChangeFreezeError } from "@/lib/change-schedule";
import { readRichBody, readRichField } from "@/lib/markdown";
import { assertRequiredCustomFields, entityFieldValues, type CustomFieldDef } from "@/lib/custom-fields";
import {
  changeRef,
  CHANGE_OUTCOME_META,
  CHANGE_TYPES,
  problemRef,
  RISKS,
  PRIORITIES,
  IMPACT_URGENCY,
  CAB_APPROVAL_RULES,
} from "@/lib/constants";

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" && v !== "" ? v : null));

const optionalText = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null));

const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? new Date(v) : null));

const createSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  description: z.string().default(""),
  type: z.enum(CHANGE_TYPES),
  risk: z.enum(RISKS),
  priority: z.enum(PRIORITIES),
  impact: z.enum(IMPACT_URGENCY),
  reason: optionalText,
  implementationPlan: optionalText,
  rollbackPlan: optionalText,
  assigneeId: optionalId,
  groupId: optionalId,
  categoryId: optionalId,
  plannedStart: optionalDate,
  plannedEnd: optionalDate,
});

export type ActionState =
  // createdId: only for /api/v1 callers (they get the id instead of a redirect).
  | { error?: string; fieldErrors?: Record<string, string[]>; createdId?: number }
  | undefined;

/**
 * What a change mutation reports back, so the page can toast success or the refusal reason.
 * `needsJustification` marks a refusal an emergency change can resolve by resubmitting with a justification.
 */
export type ChangeActionResult = { ok: true } | { ok: false; error: string; needsJustification?: true };

const OK: ChangeActionResult = { ok: true };
const refuse = (error: string): ChangeActionResult => ({ ok: false, error });

// DB-truth guards: role/isActive freeze in the JWT at login, so every mutation
// rehydrates them from the user row (see requireAgentUser / groups / sla-admin).
async function requireAgentC() {
  return requireAgentUser();
}

async function requireManagerC() {
  const me = await getCurrentUser();
  return me && me.isActive && hasRole(me.role as Role, "MANAGER") ? me : null;
}

const UNKNOWN_AFFECTED_CI = "One of the selected configuration items no longer exists.";

async function findCiOptions(where: Prisma.AssetWhereInput): Promise<{ value: string; label: string; hint: string }[]> {
  const assets = await db.asset.findMany({
    where,
    select: { id: true, name: true, type: true },
    orderBy: { name: "asc" },
    take: AFFECTED_CI_SEARCH_LIMIT,
  });
  return assets.map((a) => ({ value: a.id, label: a.name, hint: a.type }));
}

/** Configuration items matching the typed text, for picking a change's affected CIs. */
export async function searchAffectedCis(query: string): Promise<{ value: string; label: string; hint: string }[]> {
  if (!(await requireAgentC())) return [];
  return findCiOptions(affectedCiSearchWhere(query));
}

/** Configuration items matching the typed text that are not yet an affected CI of the change. */
export async function searchAttachableCis(changeId: number, query: string): Promise<{ value: string; label: string; hint: string }[]> {
  if (!(await requireAgentC())) return [];
  return findCiOptions(attachableCiSearchWhere(query, changeId));
}

export async function createChange(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const me = await requireAgentC();
  if (!me) return { error: "Not authorised" };

  // Custom-field inputs post as `cf_<key>` — collect them (the schema strips
  // the key; the JSON blob is persisted explicitly below).
  const customFields: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("cf_") && typeof v === "string") customFields[k.slice(3)] = v;
  }

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const typeError = standardTypeError(data.type, null);
  if (typeError) return { error: typeError, fieldErrors: { type: [typeError] } };

  const windowError = plannedWindowError(data.plannedStart, data.plannedEnd);
  if (windowError) {
    return { error: "Please fix the errors below.", fieldErrors: { plannedEnd: [windowError] } };
  }

  // Enforce required, currently-visible custom fields (same contract as tickets).
  const defs = await db.customFieldDef.findMany({ where: { entityType: "CHANGE", active: true } });
  if (defs.length > 0) {
    const res = assertRequiredCustomFields(defs as CustomFieldDef[], customFields, entityFieldValues({ type: data.type, priority: data.priority, risk: data.risk }));
    if (!res.ok) return { error: res.error };
  }

  const assetIds = distinctIds(formData.getAll("assetIds"));
  if (assetIds.length && (await db.asset.count({ where: { id: { in: assetIds } } })) !== assetIds.length) {
    return { error: UNKNOWN_AFFECTED_CI, fieldErrors: { assetIds: [UNKNOWN_AFFECTED_CI] } };
  }

  const change = await db.change.create({
    data: {
      ...data,
      status: "DRAFT",
      createdById: me.id,
      assets: { create: assetIds.map((assetId) => ({ assetId })) },
      ...(Object.keys(customFields).length ? { customFields: JSON.stringify(customFields) } : {}),
    },
  });

  await writeAudit({
    userId: me.id,
    action: "CREATE",
    entity: "Change",
    entityId: change.id,
    summary: `Created change "${change.title}"`,
  });
  if (data.assigneeId && data.assigneeId !== me.id) {
    await notify(data.assigneeId, {
      type: "ASSIGNED",
      title: "Change assigned to you",
      body: change.title,
      entity: "Change",
      entityId: String(change.id),
    });
  }

  revalidatePath("/changes");
  if (apiActorUserId()) return { createdId: change.id };
  redirect(`/changes/${change.id}`);
}

const updateSchema = z.object({
  id: z.coerce.number(),
  field: z.enum(["status", "type", "risk", "impact", "priority", "assigneeId", "groupId", "categoryId"]),
  value: z.string(),
  // Closing/failing/cancelling record why alongside the status move.
  outcome: optionalText,
  closureNotes: optionalText,
  cancelReason: optionalText,
});

type Agent = NonNullable<Awaited<ReturnType<typeof requireAgentC>>>;
type Tx = Prisma.TransactionClient;

type StatusMoveDetails = { outcome: string | null; closureNotes: string | null; cancelReason: string | null };

type ChangeSnapshot = {
  status: string;
  type: string;
  groupId: string | null;
  assigneeId: string | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  outcome: string | null;
  closureNotes: string | null;
};

export async function updateChangeField(formData: FormData): Promise<ChangeActionResult> {
  const me = await requireAgentC();
  if (!me) return refuse("Not authorised.");
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refuse("Invalid request.");
  const { id, field, value, ...details } = parsed.data;

  const isRelation = field.endsWith("Id");
  const valueError = isRelation ? null : fieldValueError(field, value);
  if (valueError) return refuse(valueError);

  const current = await db.change.findUnique({
    where: { id },
    select: {
      status: true, type: true, risk: true, impact: true, templateId: true, groupId: true, assigneeId: true,
      actualStart: true, actualEnd: true, outcome: true, closureNotes: true,
    },
  });
  if (!current) return refuse("Change not found.");

  if (field === "type") {
    const typeError = standardTypeError(value, current.type);
    if (typeError) return refuse(typeError);
  }
  if (field === "status") return moveChangeStatus(me, id, current, value, details);
  if (isChangeLocked(current.status)) return refuse(changeLockedMessage(current.status));

  const v = isRelation && (value === "none" || value === "") ? null : value;
  const patch: Record<string, unknown> = { [field]: v };
  // The assignee must belong to the change's group (anyone when there's none).
  if (field === "assigneeId" && v && current.groupId && !(await isGroupMember(current.groupId, v))) {
    return refuse("The assignee must be a member of the change's group.");
  }
  if (field === "groupId" && v && current.assigneeId && !(await isGroupMember(v, current.assigneeId))) {
    patch.assigneeId = null;
  }
  if (field === "groupId") {
    const freezeError = await scopeChangeFreezeError(id, { groupId: v });
    if (freezeError) return refuse(freezeError);
  }

  const leavesTemplate = leavesStandardProcedure(field, v, (current as Record<string, string | null>)[field]);
  await saveChangeEdit(me, id, current, patch, leavesTemplate, `Updated ${field}`);
  revalidatePath(`/changes/${id}`);
  revalidatePath("/changes");
  return OK;
}

/**
 * Saves an edit to a change. An edit that leaves the approved procedure of a templated standard change
 * makes it a normal change; if its pre-approval stood and the work has not started, it goes back to DRAFT
 * with a comment, because only the CAB can approve it now.
 */
async function saveChangeEdit(
  me: Agent,
  id: number,
  current: { type: string; templateId: string | null; status: string },
  data: Record<string, unknown>,
  leavesTemplate: boolean,
  summary: string,
): Promise<void> {
  const demotion = leavesTemplate ? standardDemotion(current) : null;
  if (!demotion) {
    await db.change.update({ where: { id }, data });
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: id, summary });
    return;
  }
  await db.$transaction(async (tx) => {
    await tx.change.update({
      where: { id },
      data: { type: "NORMAL", ...data, ...(demotion.backToDraft ? { status: "DRAFT" } : {}) },
    });
    if (demotion.backToDraft) {
      await tx.changeComment.create({ data: { changeId: id, authorId: me.id, isInternal: true, body: EDITED_AWAY_FROM_TEMPLATE_COMMENT } });
    }
  });
  const consequence = demotion.backToDraft ? "now a normal change, back in draft" : "now a normal change";
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: id, summary: `${summary}; edited away from the standard template, ${consequence}` });
}

/** Moves a change along its governed lifecycle, recording closure/cancellation details. */
async function moveChangeStatus(
  me: Agent,
  id: number,
  current: ChangeSnapshot,
  to: string,
  details: StatusMoveDetails,
): Promise<ChangeActionResult> {
  if (to === current.status) return OK;
  // CAB seating never happens through a manual status edit: APPROVAL seats
  // the board via submitChangeForApproval, and APPROVED is set only when decideApproval
  // records the board's approval. Allowing any of these here would let a change reach
  // the approval phase with an EMPTY board — bypassing separation-of-duties entirely.
  const manualError = manualStatusError(to);
  if (manualError) return refuse(manualError);
  // Governed lifecycle (built-in map + admin overrides + role gate). Fails closed on
  // an unknown status (never accept an arbitrary corrupt jump).
  if (!(await canTransitionConfigured("CHANGE", current.status, to, me.role as Role))) {
    return refuse(`A change cannot move from ${statusLabel(current.status)} to ${statusLabel(to)}.`);
  }

  const outcome = details.outcome ?? current.outcome;
  const closureNotes = details.closureNotes ?? current.closureNotes;
  const closureProblem = closureError({ toStatus: to, type: current.type, outcome, notes: closureNotes });
  if (closureProblem) return refuse(closureProblem);
  if (to === "CANCELLED") {
    const cancelProblem = cancelReasonError(details.cancelReason);
    if (cancelProblem) return refuse(cancelProblem);
  }

  const patch: Record<string, unknown> = { status: to };
  if (isClosureStatus(to)) Object.assign(patch, { outcome, closureNotes });
  if (to === "CANCELLED") patch.cancelReason = details.cancelReason;
  if (to === "IN_PROGRESS" && !current.actualStart) patch.actualStart = new Date();
  if (shouldStampActualEnd(to, current.actualEnd)) patch.actualEnd = new Date();

  // Guard on the status we validated against: a concurrent approval decision or move
  // must not be overwritten by this stale one.
  const withdrawn = await db.$transaction(async (tx) => {
    const moved = await tx.change.updateMany({ where: { id, status: current.status }, data: patch });
    if (moved.count === 0) return null;
    // Back to DRAFT wipes the old CAB so the next submit builds a fresh one
    // (and stale REJECTED rows don't instantly re-reject).
    if (to === "DRAFT") await tx.changeApproval.deleteMany({ where: { changeId: id } });
    return settlesApprovalBoard(to) ? withdrawPendingApprovals(tx, id) : 0;
  });
  if (withdrawn === null) return refuse("The change was updated by someone else. Reload and try again.");

  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Change",
    entityId: id,
    summary: describeStatusMove(to, { outcome, cancelReason: details.cancelReason, withdrawn }),
  });
  revalidatePath(`/changes/${id}`);
  revalidatePath("/changes");
  revalidatePath("/approvals");
  return OK;
}

/** A settled board no longer needs its undecided approvers: mark their requests withdrawn so they leave every inbox. */
async function withdrawPendingApprovals(tx: Tx, changeId: number): Promise<number> {
  const { count } = await tx.changeApproval.updateMany({
    where: { changeId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date() },
  });
  return count;
}

function describeStatusMove(
  to: string,
  { outcome, cancelReason, withdrawn }: { outcome: string | null; cancelReason: string | null; withdrawn: number },
): string {
  if (to === "CANCELLED") {
    const withdrawnNote = withdrawn > 0 ? ` (${withdrawn} pending approval${withdrawn === 1 ? "" : "s"} withdrawn)` : "";
    return `Cancelled the change: ${cancelReason}${withdrawnNote}`;
  }
  if (isClosureStatus(to) && outcome) return `Moved to ${statusLabel(to)} (outcome: ${CHANGE_OUTCOME_META[outcome]?.label ?? outcome})`;
  return `Moved to ${statusLabel(to)}`;
}

const decideSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
});

/** Flips a change out of APPROVAL (guarded against a concurrent back-to-DRAFT) and withdraws the seats nobody answered. */
async function settleBoard(tx: Tx, changeId: number, to: "APPROVED" | "REJECTED"): Promise<void> {
  const { count } = await tx.change.updateMany({ where: { id: changeId, status: "APPROVAL" }, data: { status: to } });
  if (count > 0) await withdrawPendingApprovals(tx, changeId);
}

/** Re-evaluates the board against its configured rule (UNANIMOUS | QUORUM | PERCENT) and approves the change once it is met. */
async function approveIfSatisfied(tx: Tx, changeId: number) {
  const rows = await tx.changeApproval.findMany({ where: { changeId }, select: { status: true } });
  const cfg = await tx.change.findUnique({ where: { id: changeId }, select: { approvalRule: true, approvalThreshold: true } });
  const tally = evaluateCab(rows.map((a) => a.status), cfg?.approvalRule, cfg?.approvalThreshold);
  if (tally.satisfied) await settleBoard(tx, changeId, "APPROVED");
  return tally;
}

export async function decideApproval(formData: FormData): Promise<ChangeActionResult> {
  const me = await requireAgentC();
  if (!me) return refuse("Not authorised.");
  const parsed = decideSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refuse("Invalid request.");
  const { approvalId, decision, comment } = parsed.data;

  // Separation of duties: only the assigned approver (or an admin) may decide,
  // and only while the approval is still pending.
  const existing = await db.changeApproval.findUnique({ where: { id: approvalId } });
  if (!existing) return refuse("Approval request not found.");
  if (existing.status !== "PENDING") return refuse("This approval request has already been decided or withdrawn.");
  if (existing.approverId !== me.id && me.role !== "ADMIN") return refuse("Only the assigned approver can decide this request.");
  // SoD (four-eyes): never decide on a change you own OR created, even as ADMIN, unless an
  // admin allowed self-approval (and then only on your own seat, with a role the risk accepts).
  const { changeId } = existing;
  const ownerChange = await db.change.findUnique({
    where: { id: changeId },
    select: { status: true, assigneeId: true, createdById: true, risk: true },
  });
  const selfDecision = !!ownerChange && isChangeSelfApproval(ownerChange, me.id);
  const selfMode: ChangeSelfApprovalMode = selfDecision ? await getChangeSelfApprovalMode() : "OFF";
  if (ownerChange && selfDecision) {
    const selfApproval = changeSelfApprovalError(ownerChange, me.id, {
      mode: selfMode,
      approverId: existing.approverId,
      role: me.role,
      eligibleRoles: approverRolesForRisk(ownerChange.risk),
    });
    if (selfApproval) return refuse(selfApproval);
  }
  // Approvers may be seated while the change is still a draft; they only decide once it is submitted.
  if (ownerChange?.status !== "APPROVAL") return refuse("This change is not awaiting approval yet.");
  const missingJustification = selfDecision ? selfApprovalCommentError(comment) : null;
  if (missingJustification) return refuse(missingJustification);
  const settlesAlone = selfDecision && selfDecisionSettlesBoard(selfMode);

  await db.$transaction(async (tx) => {
    await tx.changeApproval.update({ where: { id: approvalId }, data: { status: decision, comment, decidedAt: new Date() } });
    if (settlesAlone) {
      await settleBoard(tx, changeId, decision);
      return;
    }
    const tally = await approveIfSatisfied(tx, changeId);
    // A rejection ends the review only when the remaining pending seats can no
    // longer reach the required approval count (i.e. the rule is now unreachable).
    if (!tally.satisfied && decision === "REJECTED" && tally.approved + tally.pending < tally.required) {
      await settleBoard(tx, changeId, "REJECTED");
    }
  });

  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Change",
    entityId: changeId,
    summary: selfDecision
      ? `Self-approval: ${decision.toLowerCase()} ${changeRef(changeId)} as its requester/owner${settlesAlone ? " (settles the board)" : ""}`
      : `Approval ${decision.toLowerCase()} on ${changeRef(changeId)}`,
    meta: selfDecision ? { selfApproval: true, mode: selfMode, decision, justification: comment } : undefined,
  });
  revalidatePath(`/changes/${changeId}`);
  revalidatePath("/changes");
  revalidatePath("/approvals");
  return OK;
}

// ── CAB governance: submit / add / remove approvers ──────────────────────────

const submitSchema = z.object({ id: z.coerce.number(), justification: optionalText });
const addApproverSchema = z.object({ changeId: z.coerce.number(), approverId: z.string().min(1) });
const removeApproverSchema = z.object({ approvalId: z.string().min(1) });

const STALE_CHANGE_MESSAGE = "The change was updated by someone else. Reload and try again.";

type BoardChange = {
  id: number;
  type: string;
  risk: string;
  assigneeId: string | null;
  createdById: string | null;
};

/**
 * The board a draft goes to approval with: seats a manager already added stay (unless the
 * owner, creator, role or active state changed since), and the auto-selected board tops it
 * up within the type's size limit. With self-approval allowed, the owner and requester join
 * as the mode says (`seatBoard`); `selfIds` lists them.
 */
async function planCabBoard(change: BoardChange, mode: ChangeSelfApprovalMode) {
  const seats = await db.changeApproval.findMany({
    where: { changeId: change.id },
    select: { id: true, approverId: true, approver: { select: { role: true, isActive: true } } },
  });
  const seated = seats.map((s) => ({ approvalId: s.id, approverId: s.approverId, ...s.approver }));
  const eligibleRoles = approverRolesForRisk(change.risk);
  const dropped = invalidSeats(seated, change, eligibleRoles);
  const droppedIds = new Set(dropped.map((d) => d.approvalId));
  const keptIds = seated.filter((s) => !droppedIds.has(s.approvalId)).map((s) => s.approverId);
  const { autoIds, selfIds } = seatBoard({
    mode,
    selected: await selectApprovers(change),
    kept: keptIds,
    parties: mode === "OFF" ? [] : await changeParties(change),
    eligibleRoles,
    limit: boardSizeLimit(change.type),
  });
  return { dropped, keptIds, addedIds: [...selfIds, ...autoIds], selfIds };
}

/** The change's owner and requester as seating candidates, owner first. */
async function changeParties(change: BoardChange): Promise<SelfSeatCandidate[]> {
  const ids = [change.assigneeId, change.createdById].filter((v): v is string => !!v);
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true, isActive: true } });
  return ids.flatMap((id) => users.filter((u) => u.id === id));
}

const NO_FREEZE_OVERRIDE: FreezeVerdict = { ok: true, overrideComment: null };

/**
 * Checks a planned window against the change freeze windows that bind this change. An
 * EMERGENCY change may override a freeze with a justification, recorded as `overrideComment`.
 */
async function freezeVerdictFor(
  change: { id: number; type: string; groupId: string | null },
  window: PlannedWindow,
  justification: string | null,
): Promise<FreezeVerdict> {
  if (!window.start || !window.end) return NO_FREEZE_OVERRIDE;
  const hits: FreezeWindow[] = await freezeHitsForWindow(
    { start: window.start, end: window.end },
    { groupId: change.groupId, assetIds: await assetIdsOfChange(change.id) },
  );
  return freezeVerdict({ type: change.type, hits, justification });
}

function refuseFreeze(verdict: Extract<FreezeVerdict, { ok: false }>): ChangeActionResult {
  return verdict.needsJustification ? { ok: false, error: verdict.error, needsJustification: true } : refuse(verdict.error);
}

const EMERGENCY_SUBMIT_NOTE =
  "Emergency change — expedited ECAB approval. Post-Implementation Review (PIR) required after closure.";

export async function submitChangeForApproval(formData: FormData): Promise<ChangeActionResult> {
  const me = await requireAgentC();
  if (!me) return refuse("Not authorised.");
  const parsed = submitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refuse("Invalid request.");
  const { id, justification } = parsed.data;

  const current = await db.change.findUnique({
    where: { id },
    select: {
      id: true, type: true, risk: true, status: true, assigneeId: true, createdById: true, title: true, groupId: true,
      implementationPlan: true, rollbackPlan: true, plannedStart: true, plannedEnd: true,
      templateId: true, template: { select: { type: true, isActive: true } },
    },
  });
  if (!current) return refuse("Change not found.");
  // Only from DRAFT — this also makes a double-click idempotent (2nd submit is in APPROVAL).
  if (current.status !== "DRAFT") {
    return refuse("Only a draft change can be submitted for approval.");
  }

  const preApproved = preApprovalApplies(current, current.template);
  const missing = submitBlockers(current, preApproved);
  if (missing.length > 0) return refuse(submitBlockedMessage(missing));

  const freeze = await freezeVerdictFor(current, { start: current.plannedStart, end: current.plannedEnd }, justification);
  if (!freeze.ok) return refuseFreeze(freeze);

  if (preApproved) {
    // Pre-authorized by its active standard template: straight to APPROVED, no CAB. (Bypasses the transition map
    // deliberately — same authorized-flow exception decideApproval uses.)
    const approved = await db.change.updateMany({ where: { id, status: current.status }, data: { status: "APPROVED" } });
    if (approved.count === 0) return refuse(STALE_CHANGE_MESSAGE);
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: id, summary: "Standard change auto-approved (pre-authorized)" });
  } else {
    const { dropped, keptIds, addedIds, selfIds } = await planCabBoard(current, await getChangeSelfApprovalMode());
    if (keptIds.length + addedIds.length === 0) {
      // Never silently approve an unreviewed change — stay in DRAFT for a retry.
      await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: id, summary: "No eligible CAB approvers — submission blocked" });
      return refuse("No eligible CAB approvers are available for this change.");
    }
    const submitted = await db.$transaction(async (tx) => {
      const moved = await tx.change.updateMany({ where: { id, status: current.status }, data: { status: "APPROVAL" } });
      if (moved.count === 0) return false;
      await tx.changeApproval.deleteMany({ where: { id: { in: dropped.map((d) => d.approvalId) } } });
      await tx.changeApproval.createMany({ data: addedIds.map((approverId) => ({ changeId: id, approverId })) });
      if (current.type === "EMERGENCY") {
        await tx.changeComment.create({ data: { changeId: id, authorId: me.id, isInternal: true, body: EMERGENCY_SUBMIT_NOTE } });
      }
      if (freeze.overrideComment) {
        await tx.changeComment.create({ data: { changeId: id, authorId: me.id, isInternal: true, body: freeze.overrideComment } });
      }
      return true;
    });
    if (!submitted) return refuse(STALE_CHANGE_MESSAGE);
    for (const approverId of [...keptIds, ...addedIds]) {
      await notify(approverId, { type: "APPROVAL", title: "Approval needed", body: current.title, entity: "Change", entityId: String(id) });
    }
    const droppedNote = dropped.length > 0 ? ` (${dropped.length} ineligible approver${dropped.length === 1 ? "" : "s"} removed)` : "";
    const selfNote = selfIds.length > 0 ? " (requester/owner seated for self-approval)" : "";
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: id, summary: `Submitted for approval${droppedNote}${selfNote}${freeze.overrideComment ? " (change freeze overridden)" : ""}` });
  }

  revalidatePath(`/changes/${id}`);
  revalidatePath("/changes");
  revalidatePath("/approvals");
  return OK;
}

const OWN_BOARD_REFUSAL = "You cannot change the approval board of a change you own or created.";

/** SoD: the owner (assignee) or creator must not curate the board that judges their change. */
function ownsChange(userId: string, change: { assigneeId: string | null; createdById: string | null }): boolean {
  return change.assigneeId === userId || change.createdById === userId;
}

export async function addChangeApprover(formData: FormData): Promise<ChangeActionResult> {
  // Manager+ DB-truth gate — the change owner must NOT curate their own board (SoD).
  const me = await requireManagerC();
  if (!me) return refuse("Only managers can change the approval board.");
  const parsed = addApproverSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refuse("Invalid request.");
  const { changeId, approverId } = parsed.data;

  const change = await db.change.findUnique({ where: { id: changeId }, select: { assigneeId: true, createdById: true, status: true, type: true, templateId: true, risk: true, title: true } });
  if (!change) return refuse("Change not found.");
  if (ownsChange(me.id, change)) return refuse(OWN_BOARD_REFUSAL);
  if (isTemplatedStandard(change)) return refuse("A standard change is pre-authorized by its template and has no approval board.");
  if (!canSeatApprovers(change.status)) return refuse("Approvers can only be added while the change is a draft or in approval.");
  // SoD — never seat the owner (assignee) or the creator.
  if (approverId === change.assigneeId || approverId === change.createdById) {
    return refuse("The change owner or creator cannot approve their own change.");
  }
  if (!(await isEligibleApprover(approverId, change.risk))) {
    return refuse(`This person's role cannot approve a ${change.risk.toLowerCase()}-risk change.`);
  }

  // Idempotent (honors @@unique([changeId, approverId]) without a P2002 throw).
  const exists = await db.changeApproval.findFirst({ where: { changeId, approverId }, select: { id: true } });
  if (exists) return OK;
  await db.changeApproval.create({ data: { changeId, approverId } });

  // A drafted board is told only once the change is submitted (submitChangeForApproval notifies every seat).
  if (change.status === "APPROVAL") {
    await notify(approverId, { type: "APPROVAL", title: "Approval needed", body: change.title, entity: "Change", entityId: String(changeId) });
  }
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: changeId, summary: "Added approver" });
  revalidatePath(`/changes/${changeId}`);
  revalidatePath("/approvals");
  return OK;
}

export async function removeChangeApprover(formData: FormData): Promise<ChangeActionResult> {
  // Manager+ DB-truth gate — the owner must NOT prune their own board (SoD).
  const me = await requireManagerC();
  if (!me) return refuse("Only managers can change the approval board.");
  const parsed = removeApproverSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refuse("Invalid request.");
  const { approvalId } = parsed.data;

  const row = await db.changeApproval.findUnique({
    where: { id: approvalId },
    include: { change: { select: { id: true, status: true, assigneeId: true, createdById: true } } },
  });
  if (!row) return refuse("Approval request not found.");
  // Pruning a pending seat can satisfy a QUORUM/PERCENT rule — never by the owner.
  if (ownsChange(me.id, row.change)) return refuse(OWN_BOARD_REFUSAL);
  if (!canSeatApprovers(row.change.status)) return refuse("Approvers can only be removed while the change is a draft or in approval.");
  if (row.status !== "PENDING") return refuse("An approver who has already decided can't be removed.");

  // Removing a row can complete the rule (e.g. it drops the seat count under a
  // QUORUM/PERCENT target) — recompute in the same transaction; an empty board never
  // auto-approves. deleteMany (not delete): no throw when a concurrent prune already
  // removed the seat, and the audit below only fires on a real removal.
  const removed = await db.$transaction(async (tx) => {
    const gone = await tx.changeApproval.deleteMany({ where: { id: approvalId, status: "PENDING" } });
    if (gone.count === 0) return false;
    await approveIfSatisfied(tx, row.change.id);
    return true;
  });
  if (!removed) return refuse("That approval request was already decided or removed. Reload and try again.");

  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: row.change.id, summary: "Removed approver" });
  revalidatePath(`/changes/${row.change.id}`);
  revalidatePath("/approvals");
  return OK;
}

// ── CAB approval rule (quorum policy) ────────────────────────────────────────

const setRuleSchema = z.object({
  changeId: z.coerce.number(),
  rule: z.enum(CAB_APPROVAL_RULES),
  threshold: z.coerce.number().int().positive().optional(),
});

/**
 * Choose the decision rule for a change's CAB. QUORUM needs an approval count,
 * PERCENT needs a 1–100 percentage; UNANIMOUS ignores the threshold. Manager+
 * only (never the owner — SoD). Only meaningful while seating the board (DRAFT
 * before submit, or APPROVAL while the board is live), and re-evaluates whether
 * the change is now approved when the bar is lowered.
 */
export async function setCabRule(formData: FormData): Promise<ChangeActionResult> {
  // Manager+ DB-truth gate (never the owner — SoD).
  const me = await requireManagerC();
  if (!me) return refuse("Only managers can change the approval rule.");
  const parsed = setRuleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refuse("Invalid request.");
  const { changeId, rule } = parsed.data;

  const change = await db.change.findUnique({
    where: { id: changeId },
    select: { status: true, assigneeId: true, createdById: true },
  });
  if (!change) return refuse("Change not found.");
  // SoD: the owner/creator can't set the rule that judges their own change.
  if (change.assigneeId === me.id || change.createdById === me.id) {
    return refuse("You cannot set the approval rule on a change you own or created.");
  }
  // Only before or during the approval phase — locked once decided.
  if (!canSeatApprovers(change.status)) return refuse("The approval rule can only be changed while the change is a draft or in approval.");

  // Threshold only applies (and is validated) for QUORUM/PERCENT; PERCENT is 1–100.
  let threshold: number | null = null;
  if (rule === "QUORUM") threshold = parsed.data.threshold ?? null;
  else if (rule === "PERCENT") threshold = Math.min(parsed.data.threshold ?? 100, 100);

  await db.$transaction(async (tx) => {
    await tx.change.update({ where: { id: changeId }, data: { approvalRule: rule, approvalThreshold: threshold } });
    // Lowering the bar (e.g. UNANIMOUS→QUORUM) may already be satisfied by existing
    // approvals — re-evaluate so the change flips to APPROVED without another click.
    if (change.status === "APPROVAL") await approveIfSatisfied(tx, changeId);
  });

  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Change",
    entityId: changeId,
    summary: `Set CAB rule to ${rule}${threshold != null ? ` (${threshold}${rule === "PERCENT" ? "%" : ""})` : ""}`,
  });
  revalidatePath(`/changes/${changeId}`);
  revalidatePath("/approvals");
  return OK;
}

// ── Comments & edit ──────────────────────────────────────────────────────────

export async function addChangeComment(formData: FormData) {
  const me = await requireAgentC();
  if (!me) return;
  const id = Number(formData.get("changeId"));
  const isInternal = formData.get("isInternal") === "on";
  const { body, bodyHtml } = readRichBody(formData);
  if (!id || !body) return;
  await db.changeComment.create({ data: { changeId: id, authorId: me.id, body, bodyHtml, isInternal } });
  await db.change.update({ where: { id }, data: { updatedAt: new Date() } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: id, summary: "Added a comment" });
  revalidatePath(`/changes/${id}`);
}

/** A refusal when the change is missing or already a finished (closed/cancelled) record; null when it may be edited. */
async function refusalIfUneditable(id: number): Promise<ChangeActionResult | null> {
  const change = await db.change.findUnique({ where: { id }, select: { status: true } });
  if (!change) return refuse("Change not found.");
  return isChangeLocked(change.status) ? refuse(changeLockedMessage(change.status)) : null;
}

export async function updateChangeDetails(formData: FormData): Promise<ChangeActionResult> {
  const me = await requireAgentC();
  if (!me) return refuse("Not authorised.");
  const id = Number(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim();
  if (!id) return refuse("Invalid request.");
  if (title.length < 3) return refuse("Title must be at least 3 characters.");
  const uneditable = await refusalIfUneditable(id);
  if (uneditable) return uneditable;
  const { text: description, html: descriptionHtml } = readRichField(formData, "descriptionHtml", "description");
  await db.change.update({ where: { id }, data: { title, description, descriptionHtml } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: id, summary: "Edited details" });
  revalidatePath(`/changes/${id}`);
  revalidatePath("/changes");
  return OK;
}

const windowSchema = z.object({
  id: z.coerce.number(),
  plannedStart: optionalDate,
  plannedEnd: optionalDate,
  reason: optionalText,
  justification: optionalText,
});

/**
 * Sets or clears the planned maintenance window; the end must come after the start.
 * Once approved, moving the window is a reschedule: it needs a reason, which is
 * posted to the change as an internal comment. A new window inside a change freeze is
 * refused unless the change is an EMERGENCY and a justification is given.
 */
export async function updateChangeWindow(formData: FormData): Promise<ChangeActionResult> {
  const me = await requireAgentC();
  if (!me) return refuse("Not authorised.");
  const parsed = windowSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refuse("Invalid request.");
  const { id, plannedStart, plannedEnd, reason, justification } = parsed.data;

  const windowError = plannedWindowError(plannedStart, plannedEnd);
  if (windowError) return refuse(windowError);

  const change = await db.change.findUnique({ where: { id }, select: { status: true, type: true, groupId: true, plannedStart: true, plannedEnd: true } });
  if (!change) return refuse("Change not found.");
  if (isChangeLocked(change.status)) return refuse(changeLockedMessage(change.status));
  if (!isWindowEditable(change.status)) return refuse(windowLockedMessage(change.status));

  const current = { start: change.plannedStart, end: change.plannedEnd };
  const next = { start: plannedStart, end: plannedEnd };
  const rescheduleProblem = rescheduleError(change.status, current, next, reason);
  if (rescheduleProblem) return refuse(rescheduleProblem);

  // Only a moved window can newly fall into a freeze; re-saving the same one never blocks.
  const freeze = windowChanged(current, next) ? await freezeVerdictFor({ id, ...change }, next, justification) : NO_FREEZE_OVERRIDE;
  if (!freeze.ok) return refuseFreeze(freeze);

  const isReschedule = requiresRescheduleReason(change.status) && windowChanged(current, next);
  // The window and its reschedule comment are one record: never save one without the other.
  await db.$transaction(async (tx) => {
    await tx.change.update({ where: { id }, data: { plannedStart, plannedEnd } });
    if (isReschedule && reason) {
      await tx.changeComment.create({
        data: { changeId: id, authorId: me.id, isInternal: true, body: rescheduleComment(current, next, reason) },
      });
    }
    if (freeze.overrideComment) {
      await tx.changeComment.create({ data: { changeId: id, authorId: me.id, isInternal: true, body: freeze.overrideComment } });
    }
  });
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Change",
    entityId: id,
    summary: `${isReschedule ? "Rescheduled planned window" : "Updated planned window"}${freeze.overrideComment ? " (change freeze overridden)" : ""}`,
  });
  revalidatePath(`/changes/${id}`);
  revalidatePath("/changes");
  return OK;
}

// ── Planning fields (reason, implementation plan, rollback plan) ─────────────
// The change record's free-text plans, amendable at any point in the lifecycle
// until the change is closed or cancelled (e.g. adding a rollback plan before the
// CAB, or after a REVIEW). Keyed by field name via EditableTextCard.

const CHANGE_TEXT_FIELDS = ["reason", "implementationPlan", "rollbackPlan"] as const;
const changeTextSchema = z.object({
  id: z.coerce.number(),
  field: z.enum(CHANGE_TEXT_FIELDS),
  value: z.string(),
});

const CHANGE_TEXT_LABELS: Record<(typeof CHANGE_TEXT_FIELDS)[number], string> = {
  reason: "reason",
  implementationPlan: "implementation plan",
  rollbackPlan: "rollback plan",
};

export async function updateChangeText(formData: FormData): Promise<ChangeActionResult> {
  const me = await requireAgentC();
  if (!me) return refuse("Not authorised.");
  const parsed = changeTextSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refuse("Invalid request.");
  const { id, field } = parsed.data;
  const current = await db.change.findUnique({ where: { id }, select: { status: true, type: true, templateId: true, reason: true, implementationPlan: true, rollbackPlan: true } });
  if (!current) return refuse("Change not found.");
  if (isChangeLocked(current.status)) return refuse(changeLockedMessage(current.status));
  const value = parsed.data.value.trim() || null;
  const leavesTemplate = leavesStandardProcedure(field, value, current[field]);
  await saveChangeEdit(me, id, current, { [field]: value }, leavesTemplate, `Updated ${CHANGE_TEXT_LABELS[field]}`);
  revalidatePath(`/changes/${id}`);
  return OK;
}

// ── Problem link ─────────────────────────────────────────────────────────────

const isRecordId = (value: number) => Number.isInteger(value) && value > 0;

/**
 * Links the change to the problem it fixes, or unlinks it with `null`. A closed or
 * cancelled change keeps its links editable (only the descriptive fields lock).
 */
export async function setChangeProblem(changeId: number, problemId: number | null): Promise<ChangeActionResult> {
  const me = await requireAgentC();
  if (!me) return refuse("Not authorised.");
  if (!isRecordId(changeId) || (problemId !== null && !isRecordId(problemId))) return refuse("Invalid request.");

  const change = await db.change.findUnique({ where: { id: changeId }, select: { problemId: true } });
  if (!change) return refuse("Change not found.");
  if (change.problemId === problemId) return OK;
  if (problemId !== null && !(await db.problem.findUnique({ where: { id: problemId }, select: { id: true } }))) {
    return refuse("Problem not found.");
  }

  await db.change.update({ where: { id: changeId }, data: { problemId } });

  const previousId = change.problemId;
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Change",
    entityId: changeId,
    summary: problemId ? `Linked to ${problemRef(problemId)}` : `Unlinked from ${problemRef(previousId!)}`,
  });
  if (previousId) {
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Problem", entityId: previousId, summary: `Unlinked ${changeRef(changeId)}` });
    revalidatePath(`/problems/${previousId}`);
  }
  if (problemId) {
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Problem", entityId: problemId, summary: `Linked ${changeRef(changeId)}` });
    revalidatePath(`/problems/${problemId}`);
  }
  revalidatePath(`/changes/${changeId}`);
  revalidatePath("/changes");
  revalidatePath("/problems");
  return OK;
}
