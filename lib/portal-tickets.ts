import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { writeAudit, notify } from "@/lib/audit";
import { sendMail, tplTicketReceived, mailBrand, quoteHtml, textToHtmlParagraphs } from "@/lib/mail";
import { runAutomations } from "@/lib/automations";
import { autoAssignTicket } from "@/lib/assignment";
import { slaCreateData } from "@/lib/sla";
import { parseFormSchema, validateAnswers, answersToText, MAX_ANSWER_LEN } from "@/lib/service-forms";
import { isAgent, type Role } from "@/lib/session";
import { prefixForType, ticketRef } from "@/lib/constants";
import { attachDataUrlsToTicket, type IntakeFile } from "@/lib/attachment-intake";
import { notifyAssigneeAndWatchers, reopenOnCustomerReply } from "@/lib/ticket-core";
import { checkReplyRate } from "@/lib/rate-limit";

/** @deprecated Use IntakeFile from @/lib/attachment-intake. Re-exported for callers. */
export type ProposalAttachment = IntakeFile;
export { attachDataUrlsToTicket };

/** Resolve the default triage team new self-service tickets land in. */
async function triageGroupId(): Promise<string | null> {
  const g = await db.group.findFirst({ where: { name: "Service Desk" }, select: { id: true } });
  return g?.id ?? null;
}

/**
 * Re-parent staged attachments (uploaded with no target) onto a freshly created
 * ticket. Only the uploader's own still-unparented files are moved, capped, so a
 * client can't smuggle someone else's or already-linked files onto the ticket.
 */
export async function linkStagedAttachments(userId: string, ticketId: number, ids: string[]) {
  const clean = ids.filter(Boolean).slice(0, 20);
  if (clean.length === 0) return;
  await db.attachment.updateMany({
    where: { id: { in: clean }, uploadedById: userId, ticketId: null, commentId: null, articleId: null },
    data: { ticketId },
  });
}

/** Shown to the requester when they post portal replies faster than the limit. */
export const REPLY_RATE_LIMIT_MESSAGE = "You're replying too quickly. Please wait a moment and try again.";

export type PortalReplyResult = { ok: true } | { ok: false; reason: "UNAVAILABLE" | "RATE_LIMITED" };

/**
 * Post a PUBLIC reply on the user's OWN open ticket (used by the Sable assistant
 * after the user confirms). Scoped to requesterId, never internal, never on a
 * closed/cancelled ticket, and rate-limited per user.
 */
export async function addPortalReply(userId: string, ticketId: number, body: string): Promise<PortalReplyResult> {
  const clean = body.trim().slice(0, 5000);
  if (!clean) return { ok: false, reason: "UNAVAILABLE" };
  const ticket = await db.ticket.findFirst({ where: { id: ticketId, requesterId: userId }, select: { id: true, status: true } });
  if (!ticket || ticket.status === "CLOSED" || ticket.status === "CANCELLED") return { ok: false, reason: "UNAVAILABLE" };
  if (checkReplyRate(userId)) return { ok: false, reason: "RATE_LIMITED" };

  await db.ticketComment.create({ data: { ticketId, authorId: userId, body: clean, isInternal: false } });
  await reopenOnCustomerReply(ticketId, userId, clean);
  const ticketMeta = await db.ticket.findUnique({ where: { id: ticketId }, select: { prefix: true, type: true } });
  await notifyAssigneeAndWatchers(ticketId, userId, {
    type: "COMMENT",
    title: `Portal reply on ${ticketRef(ticketId, ticketMeta?.prefix || ticketMeta?.type)}`,
    body: clean.length > 160 ? `${clean.slice(0, 157)}…` : clean,
    entity: "Ticket",
    entityId: String(ticketId),
  });
  revalidatePath(`/portal/tickets/${ticketId}`);
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

type Level = "LOW" | "MEDIUM" | "HIGH";

export type PortalTicketInput = {
  title: string;
  description?: string;
  type: "INCIDENT" | "REQUEST";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  categoryId?: string | null;
  serviceId?: string | null;
  impact?: Level;
  urgency?: Level;
  /** Where the ticket came from — "PORTAL" (form) or "SABLE" (assistant). */
  source?: string;
};

/**
 * Shared core for creating a free-form self-service ticket, so the request form
 * action (lib/actions/portal.ts) and the portal Sable assistant create the SAME
 * fully-routed ticket:
 *  - lands in the Service Desk triage team by default (so it's never teamless),
 *  - runs automations (which may re-route, e.g. VPN -> Infrastructure), then
 *  - auto-assigns an agent per the resolved group's strategy.
 */
export async function createPortalTicketFor(
  me: { id: string; email?: string | null; name?: string | null },
  input: PortalTicketInput,
) {
  const sla = await slaCreateData({ serviceId: input.serviceId ?? null, priority: input.priority });
  const ticket = await db.ticket.create({
    data: {
      title: input.title,
      description: input.description ?? "",
      type: input.type,
      priority: input.priority,
      categoryId: input.categoryId ?? null,
      serviceId: input.serviceId ?? null,
      groupId: await triageGroupId(),
      prefix: prefixForType(input.type),
      ...sla,
      status: "NEW",
      source: input.source ?? "PORTAL",
      impact: input.impact ?? "MEDIUM",
      urgency: input.urgency ?? "MEDIUM",
      requesterId: me.id,
    },
  });

  await writeAudit({
    userId: me.id,
    action: "CREATE",
    entity: "Ticket",
    entityId: ticket.id,
    summary: input.source === "SABLE" ? "Created via the Sable assistant" : "Submitted via self-service portal",
  });
  if (me.email) {
    await sendMail({ to: me.email, toName: me.name, entity: "Ticket", entityId: ticket.id, ticketId: ticket.id, ...(await tplTicketReceived(ticket, await mailBrand(me), { requesterName: me.name ?? "", messageHtml: ticket.description ? quoteHtml(textToHtmlParagraphs(ticket.description)) : "" })) });
  }
  await runAutomations("TICKET_CREATED", ticket.id);
  await autoAssignTicket(ticket.id);

  revalidatePath("/portal/tickets");
  return ticket;
}

export type CatalogRequestResult =
  | { ok: true; ticket: Awaited<ReturnType<typeof db.ticket.create>> }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Shared core for ordering a catalog item (a service request with a dynamic
 * form). Used by the catalog request form action and by the portal Sable assistant
 * so a Sable-filled request routes exactly like a hand-filled one (triage team,
 * category from the item, approval flow, automations, auto-assign).
 *
 * `rawAnswers` is keyed by field key WITHOUT the `f_` prefix.
 */
export async function createCatalogRequestFor(
  me: { id: string; email?: string | null; name?: string | null },
  itemId: string,
  rawAnswers: Record<string, string>,
  source: string = "PORTAL",
): Promise<CatalogRequestResult> {
  const item = await db.catalogItem.findUnique({
    where: { id: itemId },
    include: { service: { select: { groupId: true } }, category: { select: { groupId: true } } },
  });
  if (!item || !item.isPublished) return { ok: false, error: "This item can't be requested." };
  if (item.requiresApproval && !item.approverId) {
    return { ok: false, error: "This item requires approval but has no approver configured. Please contact IT." };
  }
  // Re-check the approver is still active + an agent at REQUEST time, not just at
  // edit time — the configured approver may have been deactivated or demoted since.
  if (item.requiresApproval && item.approverId) {
    const approver = await db.user.findUnique({ where: { id: item.approverId }, select: { role: true, isActive: true } });
    if (!approver || !approver.isActive || !isAgent(approver.role as Role)) {
      return { ok: false, error: "This item requires approval but its approver is no longer available. Please contact IT." };
    }
  }

  const fields = parseFormSchema(item.formSchema);
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawAnswers)) data[`f_${k}`] = String(v ?? "");
  const { values, errors } = validateAnswers(fields, data);
  if (Object.keys(errors).length > 0) {
    return { ok: false, error: "Please complete the required fields.", fieldErrors: errors };
  }

  const summary = answersToText(fields, values);
  // Empty-schema items (the default) render a single free-text box submitted as
  // `f_details`. That value isn't part of the schema, so validateAnswers drops it
  // — capture it here so the user's typed request is never silently lost.
  const freeText = fields.length === 0 ? String(rawAnswers.details ?? "").trim().slice(0, MAX_ANSWER_LEN) : "";
  if (freeText) values.details = freeText;
  const detailText = summary || freeText;
  const description = detailText
    ? `Catalog request: ${item.name}.\n\n${detailText}`
    : `Catalog request: ${item.name}.`;
  const triage = await db.group.findFirst({ where: { name: "Service Desk" } });
  // Pre-route: the service's team, else the category's team, else Service Desk triage.
  const routeGroupId = item.service?.groupId ?? item.category?.groupId ?? triage?.id ?? null;
  const needsApproval = item.requiresApproval && !!item.approverId;
  const sla = await slaCreateData({ serviceId: item.serviceId, priority: "MEDIUM" });

  const ticket = await db.ticket.create({
    data: {
      title: `${item.name} request`,
      description,
      type: "REQUEST",
      prefix: "REQ",
      status: needsApproval ? "PENDING" : "NEW",
      source,
      priority: "MEDIUM",
      requesterId: me.id,
      catalogItemId: item.id,
      categoryId: item.categoryId,
      serviceId: item.serviceId,
      groupId: routeGroupId,
      formData: JSON.stringify(values),
      formSchema: item.formSchema,
      approvalState: needsApproval ? "PENDING" : null,
      ...sla,
      ...(needsApproval ? { pendingSince: new Date() } : {}),
    },
  });

  await writeAudit({ userId: me.id, action: "CREATE", entity: "Ticket", entityId: ticket.id, summary: `Ordered "${item.name}" from the catalog` });

  if (needsApproval && item.approverId) {
    await db.ticketApproval.create({ data: { ticketId: ticket.id, approverId: item.approverId } });
    await notify(item.approverId, {
      type: "APPROVAL", title: "Approval needed",
      body: `${me.name} requested ${item.name} (${ticketRef(ticket.id, "REQUEST")})`,
      entity: "Ticket", entityId: String(ticket.id),
    });
    const approver = await db.user.findUnique({ where: { id: item.approverId } });
    if (approver?.email) {
      await sendMail({
        to: approver.email, toName: approver.name, entity: "Ticket", entityId: ticket.id, template: "approval_request",
        subject: `[${ticketRef(ticket.id, "REQUEST")}] Approval needed: ${item.name}`,
        body: `Hi ${approver.name ?? "there"},\n\n${me.name} has requested "${item.name}".\n\n${summary}\n\nPlease review and approve or reject it in Servio under Approvals.\n\n- Servio`,
      });
    }
  }

  if (me.email) {
    await sendMail({ to: me.email, toName: me.name, entity: "Ticket", entityId: ticket.id, ticketId: ticket.id, ...(await tplTicketReceived(ticket, await mailBrand(me), { requesterName: me.name ?? "", messageHtml: ticket.description ? quoteHtml(textToHtmlParagraphs(ticket.description)) : "" })) });
  }
  if (!needsApproval) {
    await runAutomations("TICKET_CREATED", ticket.id);
    await autoAssignTicket(ticket.id);
  }

  revalidatePath("/portal/tickets");
  return { ok: true, ticket };
}
