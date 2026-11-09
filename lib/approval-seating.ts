import "server-only";

import { db } from "@/lib/db";
import { isAgent, type Role } from "@/lib/session";
import { notify } from "@/lib/audit";
import { mailBrand, sendMail } from "@/lib/mail";
import { renderApprovalRequestEmail } from "@/lib/email-templates";
import { answersToText, effectiveApprovalStages, parseFormSchema, type ApprovalStage } from "@/lib/service-forms";
import { ticketRef } from "@/lib/constants";

// ═══════════════════════════════════════════════════════════════════════════
// Multi-stage catalog approval seating.
//
// Server-side helpers (not "use server" exports — seating runs from trusted
// internal flows only: request creation and stage advancement on approval).
// ═══════════════════════════════════════════════════════════════════════════

/** Resolve the concrete approver for a stage. A named approver is used directly
 *  (if still an active agent); a group stage picks the group's lead, else its
 *  first active-agent member, so the seated TicketApproval always names a real
 *  person while /approvals still shows it to that stage's decider. Returns null
 *  when no eligible approver exists (caller should surface a config error). */
export async function resolveStageApprover(stage: ApprovalStage): Promise<string | null> {
  if (stage.approverId) {
    const u = await db.user.findUnique({ where: { id: stage.approverId }, select: { id: true, role: true, isActive: true } });
    return u && u.isActive && isAgent(u.role as Role) ? u.id : null;
  }
  if (stage.groupId) {
    const members = await db.groupMember.findMany({
      where: { groupId: stage.groupId, user: { isActive: true, isServiceAccount: false, role: { in: ["ADMIN", "MANAGER", "AGENT"] } } },
      include: { user: { select: { id: true } } },
      orderBy: [{ role: "asc" }], // LEAD sorts before MEMBER
    });
    return members[0]?.user.id ?? null;
  }
  return null;
}

/** The request's answers as text for the approver (the free-text box of a schema-less item included). */
function requestDetails(ticket: { formSchema: string | null; formData: string | null }): string {
  let values: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(ticket.formData ?? "{}");
    if (parsed && typeof parsed === "object") values = parsed;
  } catch {
    // unreadable answers: the approver still gets the request without them
  }
  const fields = parseFormSchema(ticket.formSchema);
  return fields.length > 0 ? answersToText(fields, values) : String(values.details ?? "");
}

/**
 * Seat the PENDING approval for a given stage index on a catalog request. Used
 * both to seat stage 0 at submit time and to advance to stage+1 on approval.
 * Returns true if a stage was seated, false when there is no such stage (the
 * flow has run out of stages and the request should be released) or no eligible
 * approver. The approver gets the "approval_request" email (lib/email-templates.ts)
 * in their language, with the request's answers.
 */
export async function seatCatalogStage(ticketId: number, stageIndex: number): Promise<boolean> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { requester: { select: { id: true, name: true } }, catalogItem: true },
  });
  if (!ticket || !ticket.catalogItem) return false;
  const stages = effectiveApprovalStages(ticket.catalogItem);
  const stage = stages[stageIndex];
  if (!stage) return false;

  const approverId = await resolveStageApprover(stage);
  if (!approverId) return false;

  const ref = ticketRef(ticket.id, ticket.prefix || ticket.type);
  const approval = await db.ticketApproval.create({
    data: { ticketId, approverId, stage: stageIndex },
  });
  await notify(approverId, {
    type: "APPROVAL",
    title: "Approval needed",
    body: `${ticket.requester?.name ?? "A user"} requested ${ticket.catalogItem.name} (${ref})${stages.length > 1 ? ` — stage ${stageIndex + 1} of ${stages.length}` : ""}`,
    entity: "Ticket",
    entityId: String(ticket.id),
  });
  const approver = await db.user.findUnique({ where: { id: approverId }, select: { email: true, name: true, locale: true } });
  if (approver?.email) {
    // No ticketId: the approver's mail must not join the requester's mail thread.
    await sendMail({
      to: approver.email, toName: approver.name, entity: "Ticket", entityId: ticket.id,
      ...(await renderApprovalRequestEmail({
        brand: await mailBrand(approver),
        ref,
        title: ticket.title,
        itemName: ticket.catalogItem.name,
        requesterName: ticket.requester?.name ?? "",
        approverName: approver.name ?? "",
        stageIndex,
        stageCount: stages.length,
        details: requestDetails(ticket),
      })),
    });
  }
  return !!approval;
}

/**
 * Close out the pending catalog approvals of a ticket whose status patch just
 * cancelled it (statusChangeData sets `approvalState: "CANCELLED"` then). Call
 * it after the ticket update with the same patch; it is a no-op for any other
 * patch, so every cancel path can call it unconditionally.
 */
export async function withdrawPendingApprovals(ticketId: number, patch: Record<string, unknown>): Promise<void> {
  if (patch.approvalState !== "CANCELLED") return;
  await db.ticketApproval.updateMany({
    where: { ticketId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date() },
  });
}
