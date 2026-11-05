"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, isAgent, hasRole, type Role } from "@/lib/session";
import { seatCatalogStage } from "@/lib/approval-seating";
import { writeAudit, notify } from "@/lib/audit";
import { sendMail } from "@/lib/mail";
import { resumeData, ticketCalendar } from "@/lib/sla";
import { autoAssignTicket } from "@/lib/assignment";
import { runAutomations } from "@/lib/automations";
import { effectiveApprovalStages } from "@/lib/service-forms";
import { ticketRef, APPROVAL_ENTITY_TYPES, APPROVAL_ENTITY_META, type ApprovalEntityType } from "@/lib/constants";

// ═══════════════════════════════════════════════════════════════════════════
// Multi-stage catalog approvals
//
// A catalog request walks its item's ORDERED approval stages (see
// lib/service-forms effectiveApprovalStages). Each stage seats exactly one
// PENDING TicketApproval carrying its `stage` index. Approving a stage advances
// to the next; the last stage approving releases the request into live work.
// Any rejection cancels the request (the requester can then re-request). Single-
// approver items collapse to a single implicit stage, so their behaviour is
// unchanged.
//
// The seating internals (seatCatalogStage / seatCatalogApprovalStages) live in
// lib/approval-seating.ts — server-side helpers only, never HTTP endpoints.
// ═══════════════════════════════════════════════════════════════════════════

export async function decideApproval(formData: FormData) {
  const me = await getCurrentUser();
  // Deciding a request flips a ticket's lifecycle — agent+ only, mirroring the
  // ad-hoc decideEntityApproval policy. DB truth: role/isActive rehydrated so a
  // demoted/deactivated user with a live JWT can't keep deciding. The
  // approver/admin + SoD checks follow.
  if (!me || !me.isActive || !isAgent(me.role as Role)) return;
  const approvalId = String(formData.get("approvalId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const comment = String(formData.get("comment") ?? "").trim() || null;
  if (!["APPROVED", "REJECTED"].includes(decision)) return;

  const approval = await db.ticketApproval.findUnique({
    where: { id: approvalId },
    include: {
      ticket: {
        include: { requester: true, service: true, catalogItem: true, sla: { select: { businessCalendarId: true } } },
      },
    },
  });
  if (!approval || approval.status !== "PENDING") return;
  // only the assigned approver (or an admin) may decide
  if (approval.approverId !== me.id && me.role !== "ADMIN") return;
  // separation of duties: you can never approve your own request, even as admin
  if (approval.ticket.requesterId === me.id) return;
  // The request was withdrawn (e.g. an agent cancelled it) — nothing left to decide.
  if (approval.ticket.approvalState !== "PENDING" || approval.ticket.status === "CANCELLED") return;

  await db.ticketApproval.update({
    where: { id: approvalId },
    data: { status: decision, comment, decidedAt: new Date() },
  });

  const t = approval.ticket;
  const rejected = decision === "REJECTED";

  // Multi-stage: an approval that isn't the final stage advances to the next one
  // rather than releasing the request. The request only goes live once the LAST
  // stage approves. Any rejection cancels the whole request.
  const stages = t.catalogItem ? effectiveApprovalStages(t.catalogItem) : [];
  const isMultiStage = stages.length > 1;
  const nextStageIndex = approval.stage + 1;
  const hasNextStage = !rejected && nextStageIndex < stages.length;

  await db.ticketComment.create({
    data: {
      ticketId: t.id, authorId: me.id, isInternal: true,
      body: `${rejected ? "Rejected" : "Approved"} the request${isMultiStage ? ` (stage ${approval.stage + 1} of ${stages.length})` : ""}${comment ? `: ${comment}` : "."}`,
    },
  });

  if (hasNextStage) {
    // Advance: seat the next stage; the ticket stays PENDING (clock still paused).
    const seated = await seatCatalogStage(t.id, nextStageIndex);
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: t.id, summary: `Approved stage ${approval.stage + 1} of ${stages.length}` });
    if (!seated) {
      // Couldn't route the next stage — fall through to release rather than
      // stranding the request (defensive; resolveStageApprover already ran at seat time).
      await releaseApprovedRequest(t, me.id, comment);
    } else {
      await notify(t.requesterId, {
        type: "APPROVAL_RESULT",
        title: "Approval progressed",
        body: `Stage ${approval.stage + 1} of ${stages.length} approved — ${t.catalogItem?.name ?? t.title}`,
        entity: "Ticket",
        entityId: String(t.id),
      });
    }
    revalidatePath("/approvals");
    revalidatePath(`/tickets/${t.id}`);
    revalidatePath(`/portal/tickets/${t.id}`);
    return;
  }

  if (rejected) {
    // Conditional: a concurrent cancel/decision must not be overwritten.
    const { count } = await db.ticket.updateMany({
      where: { id: t.id, approvalState: "PENDING" },
      data: { approvalState: "REJECTED", status: "CANCELLED", closedAt: new Date() },
    });
    if (count === 0) return;
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: t.id, summary: "Rejected request" });
    await notify(t.requesterId, {
      type: "APPROVAL_RESULT",
      title: "Your request was declined",
      body: `${t.catalogItem?.name ?? t.service?.name ?? t.title}`,
      entity: "Ticket",
      entityId: String(t.id),
    });
    if (t.requester?.email) {
      await sendMail({
        to: t.requester.email, toName: t.requester.name, entity: "Ticket", entityId: t.id, template: "request_rejected",
        subject: `[${ticketRef(t.id, t.type)}] Your request was declined`,
        body: `Hello,\n\nYour request "${t.title}" has been declined${comment ? `:\n\n${comment}` : "."}\n\nYou can submit a new request from the portal if needed.\n\n— Servio Service Desk`,
      });
    }
  } else {
    await releaseApprovedRequest(t, me.id, comment);
  }

  revalidatePath("/approvals");
  revalidatePath(`/tickets/${t.id}`);
  revalidatePath(`/portal/tickets/${t.id}`);
}

/** Final-stage approval: resume the SLA clock, flip the request to live work,
 *  auto-assign it, run creation automations, and notify the requester. */
async function releaseApprovedRequest(
  t: { id: number; pendingSince: Date | null; responseDueAt: Date | null; resolveDueAt: Date | null; dueAt: Date | null; pausedMs: number; type: string; title: string; requesterId: string; requester?: { email: string | null; name: string | null } | null; catalogItem?: { name: string } | null; service?: { name: string } | null; sla?: { businessCalendarId: string | null } | null },
  actorId: string,
  comment: string | null,
) {
  const resume = t.pendingSince ? resumeData(t, new Date(), await ticketCalendar(t)) : {};
  // Conditional: a concurrent cancel must not be resurrected.
  const { count } = await db.ticket.updateMany({
    where: { id: t.id, approvalState: "PENDING" },
    data: { approvalState: "APPROVED", status: "NEW", ...resume },
  });
  if (count === 0) return;
  await writeAudit({ userId: actorId, action: "UPDATE", entity: "Ticket", entityId: t.id, summary: "Approved request" });
  // Now that it's live, run the creation automations that were held back while
  // pending, then auto-assign from the routed group.
  await runAutomations("TICKET_CREATED", t.id);
  await autoAssignTicket(t.id);
  await notify(t.requesterId, {
    type: "APPROVAL_RESULT",
    title: "Your request was approved",
    body: `${t.catalogItem?.name ?? t.service?.name ?? t.title}`,
    entity: "Ticket",
    entityId: String(t.id),
  });
  if (t.requester?.email) {
    await sendMail({
      to: t.requester.email, toName: t.requester.name, entity: "Ticket", entityId: t.id, template: "request_approved",
      subject: `[${ticketRef(t.id, t.type)}] Your request was approved`,
      body: `Hello,\n\nYour request "${t.title}" has been approved and is now being actioned${comment ? `:\n\n${comment}` : "."}\n\n— Servio Service Desk`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Generic ad-hoc approvals (polymorphic Approval model)
//
// These sit alongside — not on top of — the two automated flows: the Change
// CAB (lib/actions/changes.ts) and catalog ticket approvals (decideApproval
// above). An agent can request a sign-off from a colleague on ANY entity; it's
// a governance record + notification and never drives the entity's lifecycle.
// ═══════════════════════════════════════════════════════════════════════════

function entityPath(entityType: ApprovalEntityType, entityId: string) {
  return `${APPROVAL_ENTITY_META[entityType].path}/${entityId}`;
}

const requestSchema = z.object({
  entityType: z.enum(APPROVAL_ENTITY_TYPES),
  entityId: z.string().min(1),
  approverId: z.string().min(1),
  title: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : "")),
});

/** Request an ad-hoc approval from a colleague on any entity (agent+). */
export async function requestApproval(formData: FormData) {
  // DB truth: role/isActive rehydrated (JWT freezes them at login).
  const me = await getCurrentUser();
  if (!me || !me.isActive || !isAgent(me.role as Role)) return;
  const parsed = requestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { entityType, entityId, approverId, title } = parsed.data;

  // Separation of duties: you can't request an approval from yourself.
  if (approverId === me.id) return;
  const approver = await db.user.findUnique({ where: { id: approverId }, select: { id: true, name: true, email: true, isActive: true } });
  if (!approver || !approver.isActive) return;

  // Idempotent on the [entityType, entityId, approverId] unique — re-requesting
  // just refreshes a superseded decision back to pending.
  await db.approval.upsert({
    where: { entityType_entityId_approverId: { entityType, entityId, approverId } },
    create: { entityType, entityId, approverId, requestedById: me.id, title, status: "PENDING" },
    update: { requestedById: me.id, title, status: "PENDING", comment: null, decidedAt: null },
  });

  await notify(approverId, {
    type: "APPROVAL",
    title: "Approval requested",
    body: title || `${APPROVAL_ENTITY_META[entityType].label} approval`,
    entity: APPROVAL_ENTITY_META[entityType].label,
    entityId,
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: APPROVAL_ENTITY_META[entityType].label, entityId, summary: `Requested approval from ${approver.name ?? approver.email}` });
  revalidatePath(entityPath(entityType, entityId));
  revalidatePath("/approvals");
}

const decideEntitySchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
});

/** Decide an ad-hoc approval. Only the assigned approver (or an admin) may act,
 *  and never on a sign-off they requested themselves (SoD). */
export async function decideEntityApproval(formData: FormData) {
  // DB truth: role/isActive rehydrated (JWT freezes them at login).
  const me = await getCurrentUser();
  if (!me || !me.isActive || !isAgent(me.role as Role)) return;
  const parsed = decideEntitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { approvalId, decision, comment } = parsed.data;

  const approval = await db.approval.findUnique({ where: { id: approvalId } });
  if (!approval || approval.status !== "PENDING") return;
  if (approval.approverId !== me.id && me.role !== "ADMIN") return;
  if (approval.requestedById === me.id) return; // never decide your own request

  await db.approval.update({ where: { id: approvalId }, data: { status: decision, comment, decidedAt: new Date() } });

  const entityType = approval.entityType as ApprovalEntityType;
  const meta = APPROVAL_ENTITY_META[entityType];
  if (approval.requestedById) {
    await notify(approval.requestedById, {
      type: "APPROVAL_RESULT",
      title: decision === "APPROVED" ? "Approval granted" : "Approval declined",
      body: approval.title || `${meta.label} approval`,
      entity: meta.label,
      entityId: approval.entityId,
    });
  }
  await writeAudit({ userId: me.id, action: "UPDATE", entity: meta.label, entityId: approval.entityId, summary: `Approval ${decision.toLowerCase()}` });
  revalidatePath(entityPath(entityType, approval.entityId));
  revalidatePath("/approvals");
}

/** Withdraw a pending ad-hoc approval. The requester or a manager+ may cancel. */
export async function cancelApproval(formData: FormData) {
  // DB truth: role/isActive rehydrated (JWT freezes them at login).
  const me = await getCurrentUser();
  if (!me || !me.isActive || !isAgent(me.role as Role)) return;
  const approvalId = String(formData.get("approvalId") ?? "");
  const approval = await db.approval.findUnique({ where: { id: approvalId } });
  if (!approval) return;
  if (approval.requestedById !== me.id && !hasRole(me.role as Role, "MANAGER")) return;

  await db.approval.delete({ where: { id: approvalId } });
  const entityType = approval.entityType as ApprovalEntityType;
  await writeAudit({ userId: me.id, action: "UPDATE", entity: APPROVAL_ENTITY_META[entityType].label, entityId: approval.entityId, summary: "Cancelled approval request" });
  revalidatePath(entityPath(entityType, approval.entityId));
  revalidatePath("/approvals");
}
