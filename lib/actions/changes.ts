"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser, isAgent, hasRole, type Role, requireAgentUser } from "@/lib/session";
import { writeAudit, notify } from "@/lib/audit";
import { canTransition, CHANGE_TRANSITIONS } from "@/lib/transitions";
import { canTransitionConfigured } from "@/lib/workflow";
import { isGroupMember } from "@/lib/assignment";
import { selectApprovers, isEligibleApprover, evaluateCab } from "@/lib/cab";
import { readRichBody, readRichField } from "@/lib/markdown";
import { assertRequiredCustomFields, entityFieldValues, type CustomFieldDef } from "@/lib/custom-fields";
import {
  changeRef,
  CHANGE_TYPES,
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
  | { error?: string; fieldErrors?: Record<string, string[]> }
  | undefined;

export async function createChange(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const me = await getSessionUser();
  if (!me || !isAgent(me.role as Role)) return { error: "Not authorised" };

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

  // Enforce required, currently-visible custom fields (same contract as tickets).
  const defs = await db.customFieldDef.findMany({ where: { entityType: "CHANGE", active: true } });
  if (defs.length > 0) {
    const res = assertRequiredCustomFields(defs as CustomFieldDef[], customFields, entityFieldValues({ type: data.type, priority: data.priority, risk: data.risk }));
    if (!res.ok) return { error: res.error };
  }

  const change = await db.change.create({
    data: {
      ...data,
      status: "DRAFT",
      createdById: me.id,
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
  redirect(`/changes/${change.id}`);
}

const updateSchema = z.object({
  id: z.coerce.number(),
  field: z.enum(["status", "type", "risk", "priority", "assigneeId", "groupId", "categoryId"]),
  value: z.string(),
});

export async function updateChangeField(formData: FormData) {
  const me = await getSessionUser();
  if (!me || !isAgent(me.role as Role)) return;
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { id, field, value } = parsed.data;

  const isRelation = field.endsWith("Id");
  const v = isRelation && (value === "none" || value === "") ? null : value;

  const patch: Record<string, unknown> = { [field]: v };
  if (field === "status") {
    const current = await db.change.findUnique({ where: { id }, select: { status: true, actualStart: true } });
    if (!current) return;
    // CAB seating never happens through a manual status edit: SUBMITTED/APPROVAL
    // seat the board via submitChangeForApproval, and APPROVED is set only when
    // decideApproval records unanimous approval. Allowing any of these here would
    // let a change reach the approval phase (or be marked approved) with an EMPTY
    // board — bypassing separation-of-duties entirely. Block them, even if an
    // admin workflow override would otherwise permit the transition.
    if (value !== current.status && (value === "SUBMITTED" || value === "APPROVAL" || value === "APPROVED")) return;
    // Governed lifecycle (built-in map + admin overrides + role gate). Fails
    // closed on an unknown status (never accept an arbitrary corrupt jump).
    if (!(await canTransitionConfigured("CHANGE", current.status, value, me.role as Role))) return;
    // Back to DRAFT wipes the old CAB so the next submit builds a fresh one
    // (and stale REJECTED rows don't instantly re-reject).
    if (value === "DRAFT") await db.changeApproval.deleteMany({ where: { changeId: id } });
    if (value === "IN_PROGRESS" && !current.actualStart) patch.actualStart = new Date();
    if (value === "CLOSED" || value === "FAILED") patch.actualEnd = new Date();
  }
  // The assignee must belong to the change's group (anyone when there's none).
  if (field === "assigneeId" && v) {
    const cur = await db.change.findUnique({ where: { id }, select: { groupId: true } });
    if (cur?.groupId && !(await isGroupMember(cur.groupId, v))) return;
  }
  if (field === "groupId" && v) {
    const cur = await db.change.findUnique({ where: { id }, select: { assigneeId: true } });
    if (cur?.assigneeId && !(await isGroupMember(v, cur.assigneeId))) patch.assigneeId = null;
  }

  await db.change.update({ where: { id }, data: patch });
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Change",
    entityId: id,
    summary: `Updated ${field}`,
  });
  revalidatePath(`/changes/${id}`);
  revalidatePath("/changes");
}

const decideSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
});

export async function decideApproval(formData: FormData) {
  const me = await getSessionUser();
  if (!me || !isAgent(me.role as Role)) return;
  const parsed = decideSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { approvalId, decision, comment } = parsed.data;

  // Separation of duties: only the assigned approver (or an admin) may decide,
  // and only while the approval is still pending.
  const existing = await db.changeApproval.findUnique({ where: { id: approvalId } });
  if (!existing || existing.status !== "PENDING") return;
  if (existing.approverId !== me.id && me.role !== "ADMIN") return;
  // SoD: never decide on a change you own OR created, even as ADMIN.
  const ownerChange = await db.change.findUnique({ where: { id: existing.changeId }, select: { assigneeId: true, createdById: true } });
  if (ownerChange?.assigneeId === me.id || ownerChange?.createdById === me.id) return;

  const approval = await db.changeApproval.update({
    where: { id: approvalId },
    data: { status: decision, comment, decidedAt: new Date() },
  });

  // Re-evaluate the board against its configured rule (UNANIMOUS | QUORUM | PERCENT).
  const [approvals, cfg] = await Promise.all([
    db.changeApproval.findMany({ where: { changeId: approval.changeId }, select: { status: true } }),
    db.change.findUnique({ where: { id: approval.changeId }, select: { approvalRule: true, approvalThreshold: true } }),
  ]);
  const tally = evaluateCab(approvals.map((a) => a.status), cfg?.approvalRule, cfg?.approvalThreshold);
  // Guard the status write with `status: "APPROVAL"` so a concurrent back-to-DRAFT
  // (which wipes the board) can't be overwritten by a stale APPROVED/REJECTED.
  if (tally.satisfied) {
    await db.change.updateMany({
      where: { id: approval.changeId, status: "APPROVAL" },
      data: { status: "APPROVED" },
    });
  } else if (decision === "REJECTED") {
    // A rejection ends the review only when the remaining pending seats can no
    // longer reach the required approval count (i.e. the rule is now unreachable).
    if (tally.approved + tally.pending < tally.required) {
      await db.change.updateMany({
        where: { id: approval.changeId, status: "APPROVAL" },
        data: { status: "REJECTED" },
      });
    }
  }

  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Change",
    entityId: approval.changeId,
    summary: `Approval ${decision.toLowerCase()} on ${changeRef(approval.changeId)}`,
  });
  revalidatePath(`/changes/${approval.changeId}`);
  revalidatePath("/changes");
  revalidatePath("/approvals");
}

// ── CAB governance: submit / add / remove approvers ──────────────────────────

const submitSchema = z.object({ id: z.coerce.number() });
const addApproverSchema = z.object({ changeId: z.coerce.number(), approverId: z.string().min(1) });
const removeApproverSchema = z.object({ approvalId: z.string().min(1) });

export async function submitChangeForApproval(formData: FormData) {
  const me = await getSessionUser();
  if (!me || !isAgent(me.role as Role)) return;
  const parsed = submitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { id } = parsed.data;

  const current = await db.change.findUnique({
    where: { id },
    select: { id: true, type: true, risk: true, status: true, assigneeId: true, createdById: true, title: true },
  });
  if (!current) return;
  // Only from DRAFT — this also makes a double-click idempotent (2nd submit is in APPROVAL).
  if (!canTransition(CHANGE_TRANSITIONS, current.status, "SUBMITTED", true)) return;

  if (current.type === "STANDARD") {
    // Pre-authorized: straight to APPROVED, no CAB. (Bypasses the transition map
    // deliberately — same authorized-flow exception decideApproval uses.)
    await db.change.update({ where: { id }, data: { status: "APPROVED" } });
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: id, summary: "Standard change auto-approved (pre-authorized)" });
  } else {
    const approverIds = await selectApprovers(current);
    if (approverIds.length === 0) {
      // Never silently approve an unreviewed change — stay in DRAFT for a retry.
      await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: id, summary: "No eligible CAB approvers — submission blocked" });
      return;
    }
    await db.changeApproval.createMany({ data: approverIds.map((approverId) => ({ changeId: id, approverId })) });
    await db.change.update({ where: { id }, data: { status: "APPROVAL" } });
    if (current.type === "EMERGENCY") {
      await db.changeComment.create({
        data: { changeId: id, authorId: me.id, isInternal: true, body: "Emergency change — expedited ECAB approval. Post-Implementation Review (PIR) required after closure." },
      });
    }
    for (const approverId of approverIds) {
      await notify(approverId, { type: "APPROVAL", title: "Approval needed", body: current.title, entity: "Change", entityId: String(id) });
    }
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: id, summary: "Submitted for approval" });
  }

  revalidatePath(`/changes/${id}`);
  revalidatePath("/changes");
  revalidatePath("/approvals");
}

export async function addChangeApprover(formData: FormData) {
  const me = await getSessionUser();
  if (!me) return;
  const parsed = addApproverSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { changeId, approverId } = parsed.data;

  const change = await db.change.findUnique({ where: { id: changeId }, select: { assigneeId: true, createdById: true, status: true, risk: true, title: true } });
  if (!change) return;
  // Manager+ only — the change owner must NOT curate their own approval board (SoD).
  if (!hasRole(me.role as Role, "MANAGER")) return;
  if (change.status !== "APPROVAL") return;
  // SoD — never seat the owner (assignee) or the creator.
  if (approverId === change.assigneeId || approverId === change.createdById) return;
  if (!(await isEligibleApprover(approverId, change.risk))) return;

  // Idempotent (honors @@unique([changeId, approverId]) without a P2002 throw).
  const exists = await db.changeApproval.findFirst({ where: { changeId, approverId }, select: { id: true } });
  if (exists) return;
  await db.changeApproval.create({ data: { changeId, approverId } });

  await notify(approverId, { type: "APPROVAL", title: "Approval needed", body: change.title, entity: "Change", entityId: String(changeId) });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: changeId, summary: "Added approver" });
  revalidatePath(`/changes/${changeId}`);
  revalidatePath("/approvals");
}

export async function removeChangeApprover(formData: FormData) {
  const me = await getSessionUser();
  if (!me) return;
  const parsed = removeApproverSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { approvalId } = parsed.data;

  const row = await db.changeApproval.findUnique({
    where: { id: approvalId },
    include: { change: { select: { id: true, status: true, assigneeId: true } } },
  });
  if (!row) return;
  // Manager+ only — the owner must NOT prune their own board (could force approval).
  if (!hasRole(me.role as Role, "MANAGER")) return;
  if (row.change.status !== "APPROVAL") return;

  await db.changeApproval.delete({ where: { id: approvalId } }).catch(() => {});

  // Removing a row can complete the rule (e.g. it drops the seat count under a
  // QUORUM/PERCENT target) — recompute, but never auto-approve an empty board,
  // and guard the status write against a concurrent back-to-DRAFT.
  const [remaining, cfg] = await Promise.all([
    db.changeApproval.findMany({ where: { changeId: row.change.id }, select: { status: true } }),
    db.change.findUnique({ where: { id: row.change.id }, select: { approvalRule: true, approvalThreshold: true } }),
  ]);
  const tally = evaluateCab(remaining.map((a) => a.status), cfg?.approvalRule, cfg?.approvalThreshold);
  if (tally.satisfied) {
    await db.change.updateMany({ where: { id: row.change.id, status: "APPROVAL" }, data: { status: "APPROVED" } });
  }

  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: row.change.id, summary: "Removed approver" });
  revalidatePath(`/changes/${row.change.id}`);
  revalidatePath("/approvals");
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
export async function setCabRule(formData: FormData) {
  const me = await getSessionUser();
  if (!me) return;
  const parsed = setRuleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { changeId, rule } = parsed.data;

  if (!hasRole(me.role as Role, "MANAGER")) return;
  const change = await db.change.findUnique({
    where: { id: changeId },
    select: { status: true, assigneeId: true, createdById: true },
  });
  if (!change) return;
  // SoD: the owner/creator can't set the rule that judges their own change.
  if (change.assigneeId === me.id || change.createdById === me.id) return;
  // Only before or during the approval phase — locked once decided.
  if (change.status !== "DRAFT" && change.status !== "APPROVAL") return;

  // Threshold only applies (and is validated) for QUORUM/PERCENT; PERCENT is 1–100.
  let threshold: number | null = null;
  if (rule === "QUORUM") threshold = parsed.data.threshold ?? null;
  else if (rule === "PERCENT") threshold = Math.min(parsed.data.threshold ?? 100, 100);

  await db.change.update({ where: { id: changeId }, data: { approvalRule: rule, approvalThreshold: threshold } });

  // Lowering the bar (e.g. UNANIMOUS→QUORUM) may already be satisfied by existing
  // approvals — re-evaluate so the change flips to APPROVED without another click.
  if (change.status === "APPROVAL") {
    const rows = await db.changeApproval.findMany({ where: { changeId }, select: { status: true } });
    const tally = evaluateCab(rows.map((a) => a.status), rule, threshold);
    if (tally.satisfied) {
      await db.change.updateMany({ where: { id: changeId, status: "APPROVAL" }, data: { status: "APPROVED" } });
    }
  }

  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Change",
    entityId: changeId,
    summary: `Set CAB rule to ${rule}${threshold != null ? ` (${threshold}${rule === "PERCENT" ? "%" : ""})` : ""}`,
  });
  revalidatePath(`/changes/${changeId}`);
  revalidatePath("/approvals");
}

// ── Comments & edit ──────────────────────────────────────────────────────────

async function requireAgentC() {
  // DB-truth guard (role + isActive rehydrated) — see requireAgentUser.
  return requireAgentUser();
}

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

export async function updateChangeDetails(formData: FormData) {
  const me = await requireAgentC();
  if (!me) return;
  const id = Number(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim();
  if (!id || title.length < 3) return;
  const { text: description, html: descriptionHtml } = readRichField(formData, "descriptionHtml", "description");
  await db.change.update({ where: { id }, data: { title, description, descriptionHtml } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: id, summary: "Edited details" });
  revalidatePath(`/changes/${id}`);
  revalidatePath("/changes");
}

// ── Planning fields (reason, implementation plan, rollback plan) ─────────────
// The change record's free-text plans, amendable at any point in the lifecycle
// (e.g. adding a rollback plan before the CAB, or after a REVIEW). Keyed by
// field name via EditableTextCard.

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

export async function updateChangeText(formData: FormData) {
  const me = await requireAgentC();
  if (!me) return;
  const parsed = changeTextSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { id, field } = parsed.data;
  const value = parsed.data.value.trim() || null;
  await db.change.update({ where: { id }, data: { [field]: value } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Change", entityId: id, summary: `Updated ${CHANGE_TEXT_LABELS[field]}` });
  revalidatePath(`/changes/${id}`);
}
