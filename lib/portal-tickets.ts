import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { sendMail, tplTicketReceived, tplTicketParticipant, mailBrand, quoteHtml, textToHtmlParagraphs } from "@/lib/mail";
import { runAutomations } from "@/lib/automations";
import { autoAssignTicket } from "@/lib/assignment";
import { slaCreateData } from "@/lib/sla";
import {
  parseFormSchema, validateAnswers, answersToText, MAX_ANSWER_LEN, catalogApprovalPlan, effectiveApprovalStages,
  catalogTicketType, formUrgency, renderCatalogTitle,
} from "@/lib/service-forms";
import { resolveCatalogFormLinks } from "@/lib/catalog-form-links";
import { resolveStageApprover, seatCatalogStage } from "@/lib/approval-seating";
import { prefixForType, ticketRef } from "@/lib/constants";
import { attachDataUrlsToTicket, type IntakeFile } from "@/lib/attachment-intake";
import { notifyAssigneeAndWatchers, reopenOnCustomerReply } from "@/lib/ticket-core";
import { checkReplyRate } from "@/lib/rate-limit";
import { getInstanceLocale } from "@/lib/i18n/instance";
import { catalogRequestDescription } from "@/lib/catalog-request-text";
import { getSetting, PORTAL_TRIAGE_GROUP_SETTING } from "@/lib/settings";

/** @deprecated Use IntakeFile from @/lib/attachment-intake. Re-exported for callers. */
export type ProposalAttachment = IntakeFile;
export { attachDataUrlsToTicket };

/** The triage team when none is configured, matched by name (the setting predates it). */
const DEFAULT_TRIAGE_GROUP_NAME = "Service Desk";

/** The triage team new self-service tickets land in: the configured group, else the one named "Service Desk". */
export async function triageGroupId(): Promise<string | null> {
  const configured = await getSetting(PORTAL_TRIAGE_GROUP_SETTING);
  if (configured) {
    const g = await db.group.findUnique({ where: { id: configured }, select: { id: true } });
    if (g) return g.id;
    console.warn(`[portal] triage group ${configured} no longer exists; falling back to "${DEFAULT_TRIAGE_GROUP_NAME}"`);
  }
  const g = await db.group.findFirst({ where: { name: DEFAULT_TRIAGE_GROUP_NAME }, select: { id: true } });
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
  const ticketMeta = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { prefix: true, type: true, requester: { select: { name: true, email: true } } },
  });
  const snippet = clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
  await notifyAssigneeAndWatchers(ticketId, userId, {
    type: "COMMENT",
    title: `Portal reply on ${ticketRef(ticketId, ticketMeta?.prefix || ticketMeta?.type)}`,
    body: snippet,
    entity: "Ticket",
    entityId: String(ticketId),
    email: { kind: "REQUESTER_REPLY", authorName: ticketMeta?.requester?.name ?? ticketMeta?.requester?.email ?? "", snippet },
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
 *  - lands in the triage team by default (so it's never teamless),
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

/** Link the devices and add the colleagues a catalog form named; the colleagues get the "added as participant" email. */
async function linkCatalogFormRecords(
  ticket: { id: number; title: string; type: string; prefix: string | null; status: string },
  me: { id: string; name?: string | null; email?: string | null },
  links: { assetIds: string[]; participantIds: string[] },
) {
  if (links.assetIds.length > 0) {
    await db.ticketAsset.createMany({ data: links.assetIds.map((assetId) => ({ ticketId: ticket.id, assetId })) });
  }
  for (const userId of links.participantIds) {
    await db.ticketParticipant.create({ data: { ticketId: ticket.id, userId, addedById: me.id } });
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true, locale: true } });
    if (!user?.email) continue;
    await sendMail({
      to: user.email, toName: user.name, entity: "Ticket", entityId: ticket.id, ticketId: ticket.id,
      ...(await tplTicketParticipant(ticket, user.name ?? "", me.name ?? me.email ?? "", "", await mailBrand(user))),
    });
  }
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
 * The item decides the ticket type (request or incident) and the title (template
 * with answer placeholders); an "urgency" question sets urgency and priority, an
 * "asset" question links one of the requester's devices, a "people" question adds
 * colleagues as participants.
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
  // Judge approval on the item's ordered stages at REQUEST time, not at edit time:
  // a named approver may have been deactivated or demoted since, and a group stage
  // only needs one active agent member (not the one mirrored into approverId).
  const firstStage = item.requiresApproval ? effectiveApprovalStages(item)[0] : undefined;
  const plan = catalogApprovalPlan(item, firstStage ? (await resolveStageApprover(firstStage)) !== null : false);
  if ("error" in plan) return { ok: false, error: plan.error };

  const fields = parseFormSchema(item.formSchema);
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawAnswers)) data[`f_${k}`] = String(v ?? "");
  const { values, errors } = validateAnswers(fields, data);
  if (Object.keys(errors).length > 0) {
    return { ok: false, error: "Please complete the required fields.", fieldErrors: errors };
  }
  const links = await resolveCatalogFormLinks(me.id, fields, values);
  if (Object.keys(links.errors).length > 0) {
    return { ok: false, error: "Please complete the required fields.", fieldErrors: links.errors };
  }

  const summary = answersToText(fields, values);
  // Empty-schema items (the default) render a single free-text box submitted as
  // `f_details`. That value isn't part of the schema, so validateAnswers drops it
  // — capture it here so the user's typed request is never silently lost.
  const freeText = fields.length === 0 ? String(rawAnswers.details ?? "").trim().slice(0, MAX_ANSWER_LEN) : "";
  if (freeText) values.details = freeText;
  const detailText = summary || freeText;
  const description = catalogRequestDescription(await getInstanceLocale(), item.name, detailText);
  // Pre-route: the item's own team, else the service's, else the category's, else the triage team.
  const routeGroupId = item.groupId ?? item.service?.groupId ?? item.category?.groupId ?? (await triageGroupId());
  const needsApproval = plan.stages.length > 0;
  const type = catalogTicketType(item.ticketType);
  const urgency = formUrgency(fields, values);
  const priority = urgency ?? "MEDIUM";
  const sla = await slaCreateData({ serviceId: item.serviceId, priority });

  const ticket = await db.ticket.create({
    data: {
      title: renderCatalogTitle(item.titleTemplate, { itemName: item.name, requesterName: me.name ?? me.email ?? "", fields, values }),
      description,
      type,
      prefix: prefixForType(type),
      status: needsApproval ? "PENDING" : "NEW",
      source,
      priority,
      ...(urgency ? { urgency } : {}),
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
  await linkCatalogFormRecords(ticket, me, links);

  // Seat the first stage: its named approver, or the group's lead / first active agent.
  if (needsApproval && !(await seatCatalogStage(ticket.id, 0))) {
    // The approver went away between the check and the seat: leave a trail; the
    // request stays PENDING until an admin fixes the item or it is re-requested.
    await db.ticketComment.create({
      data: { ticketId: ticket.id, authorId: me.id, isInternal: true, body: "Approval could not be routed: no eligible approver for the first stage." },
    });
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
