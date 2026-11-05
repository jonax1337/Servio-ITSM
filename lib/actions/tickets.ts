"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { type Role, requireAgentUser } from "@/lib/session";
import { writeAudit, notify } from "@/lib/audit";

/** Only agents/managers/admins may act on the agent console. */
async function requireAgent() {
  // DB-truth guard (role + isActive rehydrated) — see requireAgentUser.
  return requireAgentUser();
}
import {
  sendMail, ticketThreadHeaders, mailBrand,
  tplTicketAssigned, tplTicketParticipant,
  textToHtmlParagraphs, renderEmailHtml, renderThreadHistory,
} from "@/lib/mail";
import { renderTicketResolvedEmail } from "@/lib/email-templates";
import { ensureSurvey, surveyUrl } from "@/lib/csat-survey";
import { sanitizeCommentHtml, htmlToText } from "@/lib/markdown";
import { format } from "date-fns";
import { runAutomations } from "@/lib/automations";
import { autoAssignTicket, isGroupMember } from "@/lib/assignment";
import { canActOnTicket } from "@/lib/authz";
import { withdrawPendingApprovals } from "@/lib/approval-seating";
import {
  firstResponseData, pauseData, resumeData, statusChangeData, ticketCalendar,
} from "@/lib/sla";
import { canTransitionConfigured } from "@/lib/workflow";
import { approvalAllowsStatus } from "@/lib/transitions";
import {
  TICKET_TYPES,
  PRIORITIES,
  IMPACT_URGENCY,
  ticketRef,
  problemRef,
  changeRef,
} from "@/lib/constants";
import {
  createSchema, createTicketCore, deliverTicketReply, notifyWatchers,
  ticketCcEmails, slaRepricePatch, TICKET_LINK_TYPES, EMAIL_RE,
  type TicketActionResult,
} from "@/lib/ticket-core";

/** Load a ticket's owner/group and confirm the actor may act on it. Void-returns
 *  (silent abort) match the actions' existing unauthorized behaviour. */
async function ensureCanAct(ticketId: number, me: { id: string; role: string }): Promise<boolean> {
  const t = await db.ticket.findUnique({ where: { id: ticketId }, select: { assigneeId: true, groupId: true } });
  if (!t) return false;
  return canActOnTicket(me, t);
}

export type ActionState = { error?: string; fieldErrors?: Record<string, string[]> } | undefined;

export async function createTicket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAgent();
  if (!me) return { error: "Not authorised" };

  const raw = Object.fromEntries(formData) as Record<string, unknown>;
  // Custom-field inputs post as `cf_<key>` — collect them into the schema's map.
  const customFields: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("cf_") && typeof v === "string") customFields[k.slice(3)] = v;
  }
  if (Object.keys(customFields).length) raw.customFields = customFields;

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  let ticket;
  try {
    ticket = await createTicketCore(parsed.data, me.id);
  } catch (e) {
    // Required-custom-field (or other create-time) validation aborts here.
    return { error: e instanceof Error ? e.message : "Could not create the ticket." };
  }

  revalidatePath("/tickets");
  redirect(`/tickets/${ticket.id}`);
}

/**
 * The approvalState a cancelled ticket ends up with: CANCELLED when it was still
 * awaiting approval, otherwise undefined (leave it). Reuses statusChangeData so
 * paths that build their own patch (resolution dialog, merge) follow the same rule.
 */
function cancelledApprovalState(ticket: Parameters<typeof statusChangeData>[0], now = new Date()) {
  return statusChangeData(ticket, "CANCELLED", now).approvalState as string | undefined;
}

const updateSchema = z.object({
  id: z.coerce.number(),
  field: z.enum([
    "status", "priority", "impact", "urgency", "type",
    "assigneeId", "groupId", "categoryId", "serviceId", "slaId",
  ]),
  value: z.string(),
});

export async function updateTicketField(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return refused(NOT_AUTHORISED);
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refused(INVALID_CHANGE);
  const { id, field, value } = parsed.data;

  const isRelation = field.endsWith("Id");
  const v = isRelation && (value === "none" || value === "") ? null : value;

  // Authorization: only ADMIN/MANAGER, or the assignee / a member of the ticket's
  // group, may mutate a ticket.
  if (!(await ensureCanAct(id, me))) return refused(NOT_YOUR_TICKET);

  // Validate String-backed "enum" values against lib/constants.ts so a forged
  // POST can't write an off-list priority/impact/urgency/type.
  const ENUM_FIELDS: Record<string, readonly string[]> = {
    priority: PRIORITIES,
    impact: IMPACT_URGENCY,
    urgency: IMPACT_URGENCY,
    type: TICKET_TYPES,
  };
  if (field in ENUM_FIELDS && !ENUM_FIELDS[field].includes(value)) return refused(INVALID_CHANGE);

  const patch: Record<string, unknown> = { [field]: v };
  if (field === "status") {
    const current = await db.ticket.findUnique({
      where: { id },
      include: { sla: { select: { businessCalendarId: true } } },
    });
    if (!current) return refused(TICKET_NOT_FOUND);
    if (!approvalAllowsStatus(current.approvalState, value)) return refused(AWAITING_APPROVAL);
    // Enforce the configured lifecycle (built-in map + admin overrides + role).
    if (!(await canTransitionConfigured("TICKET", current.status, value, me.role as Role))) return refused(TRANSITION_NOT_ALLOWED);
    // Shared with the automation engine so both keep the SLA clock consistent.
    const now = new Date();
    Object.assign(patch, statusChangeData(current, value, now, await ticketCalendar(current)));
    // The resolution notice is the requester's first answer when nobody replied before.
    if (value === "RESOLVED" && !current.firstResponseAt) Object.assign(patch, firstResponseData(current, now));
  }
  // Verify a relation FK actually exists before writing it (a bogus id would
  // otherwise 500 on the FK constraint or dangle).
  if (isRelation && v) {
    const relExists: Record<string, () => Promise<boolean>> = {
      assigneeId: async () => !!(await db.user.findUnique({ where: { id: v }, select: { id: true } })),
      groupId: async () => !!(await db.group.findUnique({ where: { id: v }, select: { id: true } })),
      categoryId: async () => !!(await db.category.findUnique({ where: { id: v }, select: { id: true } })),
      serviceId: async () => !!(await db.service.findUnique({ where: { id: v }, select: { id: true } })),
      slaId: async () => !!(await db.sLA.findUnique({ where: { id: v }, select: { id: true } })),
    };
    const check = relExists[field];
    if (check && !(await check())) return refused(INVALID_CHANGE);
  }
  // The assignee must belong to the ticket's group (anyone when there's no group).
  if (field === "assigneeId" && v) {
    const current = await db.ticket.findUnique({ where: { id }, select: { groupId: true } });
    if (current?.groupId && !(await isGroupMember(current.groupId, v))) return refused(ASSIGNEE_NOT_IN_GROUP);
  }
  // Re-routing to a group the current assignee isn't in clears the assignee
  // (auto-assign below then picks an eligible member).
  if (field === "groupId" && v) {
    const current = await db.ticket.findUnique({ where: { id }, select: { assigneeId: true } });
    if (current?.assigneeId && !(await isGroupMember(v, current.assigneeId))) patch.assigneeId = null;
  }

  // SLA recompute: changing priority/service/SLA on an OPEN ticket must re-stamp
  // the response/resolve deadlines, banking already-paused time and preserving a
  // recorded first response — otherwise the clock goes stale against the new SLA.
  // Shared with the macro engine's set_priority via slaRepricePatch so both
  // writers re-price identically.
  if (field === "priority" || field === "serviceId" || field === "slaId") {
    const current = await db.ticket.findUnique({
      where: { id },
      select: {
        status: true, firstResponseAt: true, createdAt: true, pausedMs: true,
        priority: true, serviceId: true, slaId: true,
      },
    });
    Object.assign(patch, await slaRepricePatch(
      current,
      {
        priority: field === "priority" ? value : current?.priority ?? "",
        serviceId: field === "serviceId" ? v : current?.serviceId ?? null,
        slaId: field === "slaId" ? v : current?.slaId ?? null,
      },
      { slaChosen: field === "slaId", slaCleared: field === "slaId" && v === null },
    ));
  }

  const ticket = await db.ticket.update({
    where: { id },
    data: patch,
    include: { requester: true, assignee: true },
  });
  await withdrawPendingApprovals(id, patch);
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: `Updated ${field}` });

  if (field === "status" && value === "RESOLVED") await sendResolvedMail(ticket, me.email, null);
  if (field === "assigneeId" && ticket.assignee?.email && ticket.assigneeId !== me.id) {
    await notify(ticket.assigneeId!, { type: "ASSIGNED", title: "Ticket assigned to you", body: ticket.title, entity: "Ticket", entityId: String(ticket.id) });
    await sendMail({ to: ticket.assignee.email, toName: ticket.assignee.name, entity: "Ticket", entityId: ticket.id, ticketId: ticket.id, ...(await tplTicketAssigned(ticket, ticket.assignee.name ?? "there", await mailBrand())) });
  }

  await runAutomations("TICKET_UPDATED", id);
  // After automations may have (re)routed the ticket to a team, auto-assign it
  // (no-op if it already has an assignee or the team has no strategy).
  if (field === "groupId" && v) await autoAssignTicket(id);

  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
  return { ok: true };
}

/**
 * Apply one field change to many tickets at once (bulk action). Reuses
 * updateTicketField per ticket so transitions, the SLA clock, automations and
 * notifications all still run correctly; invalid status transitions are skipped.
 */
export async function bulkUpdateTickets(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "");
  if (!ids.length || !["status", "priority", "assigneeId", "groupId"].includes(field)) return;

  for (const id of ids) {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("field", field);
    fd.set("value", value);
    await updateTicketField(fd);
  }
  revalidatePath("/tickets");
}

export async function addTicketComment(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = Number(formData.get("ticketId"));
  const isInternal = formData.get("isInternal") === "on";

  // Rich text: sanitize the HTML (server is the real boundary) and derive the
  // plaintext twin for search / notifications / mentions. Legacy plaintext path
  // still works when only `body` is posted.
  const rawHtml = formData.get("bodyHtml");
  let body: string;
  let bodyHtml: string | null;
  if (typeof rawHtml === "string" && rawHtml.trim()) {
    bodyHtml = sanitizeCommentHtml(rawHtml);
    body = htmlToText(bodyHtml).trim();
  } else {
    bodyHtml = null;
    body = String(formData.get("body") ?? "").trim();
  }
  if (!id || !body) return;
  // Only the assignee / a group member / MANAGER+ may add to a ticket's thread.
  if (!(await ensureCanAct(id, me))) return;

  // Re-parent files staged on the ticket while composing onto this comment.
  // Guarded to the author's own not-yet-attached drafts on THIS ticket (nothing
  // else can be hijacked), capped, and atomic with the create so a concurrent
  // double-submit can't misparent a file.
  const attachmentIds = formData.getAll("attachmentIds").map(String).filter(Boolean).slice(0, 20);
  const comment = await db.$transaction(async (tx) => {
    const c = await tx.ticketComment.create({ data: { ticketId: id, authorId: me.id, body, bodyHtml, isInternal } });
    if (attachmentIds.length) {
      await tx.attachment.updateMany({
        where: { id: { in: attachmentIds }, ticketId: id, commentId: null, uploadedById: me.id },
        data: { commentId: c.id, ticketId: null },
      });
    }
    return c;
  });

  const ticket = await db.ticket.update({
    where: { id },
    data: { updatedAt: new Date() },
    include: { requester: true },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: "Added a comment" });

  // First-response stamping + mention/watcher notifications + the outbound reply
  // email are the single source of truth for "a reply went out" — shared with
  // applyMacro so a macro's public reply behaves exactly like a hand-typed one.
  await deliverTicketReply({
    ticket,
    comment,
    author: me,
    body,
    bodyHtml,
    isInternal,
    hasAttachments: attachmentIds.length > 0,
    toRecipients: formData.get("toRecipients"),
    ccRecipients: formData.get("ccRecipients"),
    bccRecipients: formData.get("bccRecipients"),
    quoteFromCommentId: String(formData.get("quoteFromCommentId") ?? ""),
  });

  revalidatePath(`/tickets/${id}`);
}

// ── Collaboration helpers ──────────────────────────────────────────────────

const PRIORITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

function escapeInlineText(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Why a ticket change was refused — surfaced to the agent instead of a silent no-op.
const NOT_AUTHORISED = "You are not signed in as an agent.";
const NOT_YOUR_TICKET = "You can't change this ticket — it belongs to a group you're not a member of.";
const AWAITING_APPROVAL = "This request is awaiting approval; it can only be cancelled until it is decided.";
const TRANSITION_NOT_ALLOWED = "The status workflow doesn't allow this change.";
const ASSIGNEE_NOT_IN_GROUP = "That agent isn't a member of the ticket's group.";
const TICKET_NOT_FOUND = "Ticket not found.";
const INVALID_CHANGE = "That change isn't valid for this ticket.";
const refused = (error: string): TicketActionResult => ({ ok: false, error });

type ResolvedMailTicket = {
  id: number; title: string; type: string; prefix: string | null;
  requester: { email: string | null; name: string | null } | null;
};

/**
 * The resolution notice to the requester: participants in CC, threaded onto the
 * ticket's mail conversation, carrying the public resolution note and the CSAT
 * "Rate our support" link (a survey token is minted or reused per ticket).
 */
async function sendResolvedMail(ticket: ResolvedMailTicket, actorEmail: string, resolutionNote: string | null) {
  const surveyToken = await ensureSurvey(ticket.id);
  if (!ticket.requester?.email) return;
  await sendMail({
    to: ticket.requester.email, toName: ticket.requester.name,
    cc: await ticketCcEmails(ticket.id, [ticket.requester.email, actorEmail]),
    entity: "Ticket", entityId: ticket.id, ticketId: ticket.id,
    ...(await ticketThreadHeaders(ticket.id)),
    ...(await renderTicketResolvedEmail({
      brand: await mailBrand(),
      ref: ticketRef(ticket.id, ticket.prefix || ticket.type),
      title: ticket.title,
      requesterName: ticket.requester.name ?? "",
      surveyUrl: surveyToken ? await surveyUrl(surveyToken) : null,
      resolutionNote,
    })),
  });
}

// ── Ticket actions ─────────────────────────────────────────────────────────

export async function escalateTicket(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return { ok: false, error: "Not authorised." };
  const id = Number(formData.get("id"));
  if (!id) return { ok: false, error: "Missing ticket." };
  const t = await db.ticket.findUnique({ where: { id } });
  if (!t) return { ok: false, error: "Ticket not found." };
  if (!(await canActOnTicket(me, t))) return { ok: false, error: "You can't act on this ticket." };
  // Already at the top of the scale → say so instead of re-writing/re-notifying
  // (and re-auditing) on every click.
  if (t.priority === "CRITICAL") return { ok: false, error: "Priority is already Critical" };
  const next = PRIORITY_ORDER[Math.min(PRIORITY_ORDER.indexOf(t.priority as (typeof PRIORITY_ORDER)[number]) + 1, 3)];
  // Route the implicit NEW→OPEN through the configured lifecycle instead of
  // forcing it; if the transition isn't allowed for this role, leave status as-is.
  const toOpen = t.status === "NEW" && (await canTransitionConfigured("TICKET", "NEW", "OPEN", me.role as Role));
  // A priority change re-prices the SLA — same contract as updateTicketField,
  // so the deadlines track the new tier instead of going stale.
  const sla = await slaRepricePatch(t, { priority: next, serviceId: t.serviceId, slaId: t.slaId });
  await db.ticket.update({ where: { id }, data: { priority: next, status: toOpen ? "OPEN" : t.status, ...sla } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: `Escalated priority to ${next}` });
  if (t.assigneeId) await notify(t.assigneeId, { type: "ESCALATION", title: `Ticket escalated to ${next}`, body: t.title, entity: "Ticket", entityId: String(id) });
  await notifyWatchers(id, me.id, { type: "ESCALATION", title: `Ticket escalated to ${next}`, body: t.title, entity: "Ticket", entityId: String(id) });
  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
  return { ok: true };
}

export async function toggleMajorIncident(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = Number(formData.get("id"));
  if (!id) return;
  const t = await db.ticket.findUnique({ where: { id }, include: { assignee: true } });
  if (!t) return;
  if (!(await canActOnTicket(me, t))) return;
  const now = !t.isMajorIncident;
  // Route the implicit NEW→OPEN through the configured lifecycle rather than
  // forcing it (leave status untouched when the transition isn't allowed).
  const toOpen = t.status === "NEW" && (await canTransitionConfigured("TICKET", "NEW", "OPEN", me.role as Role));
  // Declaring a Major bumps priority to CRITICAL — re-price the SLA with it,
  // same contract as updateTicketField.
  const sla = now ? await slaRepricePatch(t, { priority: "CRITICAL", serviceId: t.serviceId, slaId: t.slaId }) : {};
  await db.ticket.update({
    where: { id },
    data: now ? { isMajorIncident: true, priority: "CRITICAL", status: toOpen ? "OPEN" : t.status, ...sla } : { isMajorIncident: false },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: now ? "Declared a Major Incident" : "Cleared Major Incident" });
  if (now) {
    if (t.assigneeId) await notify(t.assigneeId, { type: "MAJOR_INCIDENT", title: "Major Incident declared", body: t.title, entity: "Ticket", entityId: String(id) });
    await notifyWatchers(id, me.id, { type: "MAJOR_INCIDENT", title: "Major Incident declared", body: t.title, entity: "Ticket", entityId: String(id) });
  }
  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
}

export async function toggleWatch(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return { ok: false, error: "Not authorised." };
  const id = Number(formData.get("id"));
  if (!id) return { ok: false, error: "Missing ticket." };
  // Existence check first so a bogus id can't blow up on the FK constraint.
  const ticket = await db.ticket.findUnique({ where: { id }, select: { id: true } });
  if (!ticket) return { ok: false, error: "Ticket not found." };
  const existing = await db.ticketWatcher.findUnique({ where: { ticketId_userId: { ticketId: id, userId: me.id } } });
  if (existing) await db.ticketWatcher.delete({ where: { ticketId_userId: { ticketId: id, userId: me.id } } });
  else await db.ticketWatcher.create({ data: { ticketId: id, userId: me.id } });
  revalidatePath(`/tickets/${id}`);
  return { ok: true };
}

export async function linkTicket(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = Number(formData.get("id"));
  const targetId = Number(formData.get("targetId"));
  const type = String(formData.get("type") || "RELATED");
  if (!id || !targetId || id === targetId) return;
  // Validate the link type against the canonical tuple so a forged POST can't
  // write an off-list relation (same contract as updateTicketField's enum guard).
  if (!TICKET_LINK_TYPES.includes(type as (typeof TICKET_LINK_TYPES)[number])) return;
  if (!(await ensureCanAct(id, me))) return;
  // Validate the target ticket exists before linking to it.
  const target = await db.ticket.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!target) return;
  await db.ticketLink.upsert({
    where: { ticketId_linkedTicketId: { ticketId: id, linkedTicketId: targetId } },
    create: { ticketId: id, linkedTicketId: targetId, type },
    update: { type },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: `Linked to ${ticketRef(targetId)}` });
  revalidatePath(`/tickets/${id}`);
}

export async function unlinkTicket(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return { ok: false, error: "Not authorised." };
  const linkId = String(formData.get("linkId"));
  if (!linkId) return { ok: false, error: "Missing link." };
  // Derive the ticket from the link row itself — trusting a client-posted
  // (or absent) ticketId would skip authorization entirely.
  const link = await db.ticketLink.findUnique({ where: { id: linkId }, select: { ticketId: true } });
  if (!link) return { ok: false, error: "Link not found." };
  if (!(await ensureCanAct(link.ticketId, me))) return { ok: false, error: "You can't act on this ticket." };
  await db.ticketLink.delete({ where: { id: linkId } });
  revalidatePath(`/tickets/${link.ticketId}`);
  return { ok: true };
}

export async function mergeTicket(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = Number(formData.get("id"));
  const targetId = Number(formData.get("targetId"));
  if (!id || !targetId || id === targetId) return;

  const source = await db.ticket.findUnique({
    where: { id },
    include: { comments: { orderBy: { createdAt: "asc" } }, watchers: true },
  });
  if (!source) return;
  // Only ADMIN/MANAGER, or the source's assignee / a member of its group, may merge it.
  if (!(await canActOnTicket(me, source))) return;
  // Don't re-merge a ticket that's already merged/cancelled.
  if (source.mergedIntoId || source.status === "CANCELLED") return;

  // Pre-validate the target: it must exist and not itself be merged/cancelled, and
  // merging into it must not form a cycle (target already points back at the source).
  const target = await db.ticket.findUnique({
    where: { id: targetId },
    select: { id: true, mergedIntoId: true, status: true, assigneeId: true, groupId: true },
  });
  if (!target || target.status === "CANCELLED") return;
  // The actor must be allowed to act on the TARGET too — merging writes comments,
  // watchers and a link into it, so it's not enough to clear the source only.
  if (!(await canActOnTicket(me, target))) return;
  if (target.mergedIntoId === id || source.mergedIntoId === targetId) return;

  // All writes in one transaction so a partial merge can't leave orphaned comments
  // with the source still open.
  await db.$transaction(async (tx) => {
    // 1) Carry the source's description + comments into the target (attributed to original authors)
    await tx.ticketComment.create({
      data: {
        ticketId: targetId, authorId: me.id, isInternal: true,
        body: `⤵︎ Merged from ${ticketRef(source.id, source.type)} — "${source.title}"\n\n${source.description || "(no description)"}`,
      },
    });
    for (const c of source.comments) {
      await tx.ticketComment.create({
        data: {
          ticketId: targetId, authorId: c.authorId, isInternal: c.isInternal,
          body: `[from ${ticketRef(source.id, source.type)}] ${c.body}`,
          createdAt: c.createdAt,
        },
      });
    }

    // 2) Move watchers + any linked assets over to the target
    for (const w of source.watchers) {
      await tx.ticketWatcher.upsert({
        where: { ticketId_userId: { ticketId: targetId, userId: w.userId } },
        create: { ticketId: targetId, userId: w.userId },
        update: {},
      });
    }
    const srcAssets = await tx.ticketAsset.findMany({ where: { ticketId: id } });
    for (const a of srcAssets) {
      await tx.ticketAsset.upsert({
        where: { ticketId_assetId: { ticketId: targetId, assetId: a.assetId } },
        create: { ticketId: targetId, assetId: a.assetId },
        update: {},
      });
    }

    // 3) Close the source as merged, and cross-link
    await tx.ticket.update({
      where: { id },
      data: { mergedIntoId: targetId, status: "CANCELLED", closedAt: new Date(), approvalState: cancelledApprovalState(source) },
    });
    await tx.ticketComment.create({ data: { ticketId: id, authorId: me.id, isInternal: true, body: `Merged into ${ticketRef(targetId)}. Comments, watchers and assets were carried over.` } });
    await tx.ticketLink.upsert({
      where: { ticketId_linkedTicketId: { ticketId: targetId, linkedTicketId: id } },
      create: { ticketId: targetId, linkedTicketId: id, type: "DUPLICATE" },
      update: { type: "DUPLICATE" },
    });
  });
  await withdrawPendingApprovals(id, { approvalState: cancelledApprovalState(source) });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: `Merged into ${ticketRef(targetId)}` });

  revalidatePath(`/tickets/${id}`);
  revalidatePath(`/tickets/${targetId}`);
  redirect(`/tickets/${targetId}`);
}

// ── Resolution / cancel ──────────────────────────────────────────────────────

export async function setTicketResolution(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return refused(NOT_AUTHORISED);
  const id = Number(formData.get("id"));
  const status = String(formData.get("status") ?? "");
  const code = String(formData.get("code") ?? "").trim() || null;
  const rawHtml = formData.get("bodyHtml");
  const bodyHtml = typeof rawHtml === "string" && rawHtml.trim() ? sanitizeCommentHtml(rawHtml) : null;
  const note = bodyHtml ? htmlToText(bodyHtml).trim() || null : String(formData.get("note") ?? "").trim() || null;
  const noteInternal = formData.get("isInternal") === "on";
  if (!id || !["RESOLVED", "CLOSED", "CANCELLED"].includes(status)) return refused(INVALID_CHANGE);

  const current = await db.ticket.findUnique({
    where: { id },
    include: { sla: { select: { businessCalendarId: true } } },
  });
  if (!current) return refused(TICKET_NOT_FOUND);
  if (!(await canActOnTicket(me, current))) return refused(NOT_YOUR_TICKET);
  if (!approvalAllowsStatus(current.approvalState, status)) return refused(AWAITING_APPROVAL);
  if (!(await canTransitionConfigured("TICKET", current.status, status, me.role as Role))) return refused(TRANSITION_NOT_ALLOWED);

  const now = new Date();
  const clock: Record<string, unknown> = {};
  if (status === "RESOLVED") {
    // Stop the clock: resume/shift out of any pause, then judge breach vs the shifted deadline.
    let effResolveDueAt = current.resolveDueAt;
    if (current.pendingSince) {
      const resumed = resumeData(current, now, await ticketCalendar(current));
      Object.assign(clock, resumed);
      effResolveDueAt = resumed.resolveDueAt ?? current.resolveDueAt;
    }
    clock.resolveBreached = effResolveDueAt ? now > effResolveDueAt : false;
    // The resolution notice is the requester's first answer when nobody replied before.
    if (!current.firstResponseAt) Object.assign(clock, firstResponseData(current, now));
  } else if (current.pendingSince) {
    // CLOSED/CANCELLED from a paused state: just clear the anchor + bank paused time,
    // no point shifting deadlines on a terminal, non-resolved ticket.
    clock.pendingSince = null;
    clock.pausedMs = current.pausedMs + Math.max(0, now.getTime() - current.pendingSince.getTime());
  }

  const data = {
    status,
    resolutionCode: status === "CANCELLED" ? null : code,
    resolutionNote: note,
    resolvedAt: status === "RESOLVED" ? now : undefined,
    closedAt: status === "CLOSED" || status === "CANCELLED" ? now : undefined,
    approvalState: status === "CANCELLED" ? cancelledApprovalState(current, now) : undefined,
    ...clock,
  };
  const ticket = await db.ticket.update({ where: { id }, data, include: { requester: true } });
  await withdrawPendingApprovals(id, data);

  const verb = status === "CANCELLED" ? "Cancelled" : status === "CLOSED" ? "Closed" : "Resolved";
  await db.ticketComment.create({
    data: {
      ticketId: id,
      authorId: me.id,
      isInternal: noteInternal,
      body: note ?? `${verb}${code ? ` (${code.replace(/_/g, " ").toLowerCase()})` : ""}.`,
      bodyHtml,
    },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: `${verb} ticket` });

  if (status === "RESOLVED") await sendResolvedMail(ticket, me.email, noteInternal ? null : note);
  await runAutomations("TICKET_UPDATED", id);
  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
  return { ok: true };
}

// ── Unlink relations ─────────────────────────────────────────────────────────

export async function unlinkAsset(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const ticketId = Number(formData.get("ticketId"));
  const assetId = String(formData.get("assetId") ?? "");
  if (!ticketId || !assetId) return;
  if (!(await ensureCanAct(ticketId, me))) return;
  // Existence pre-check: an already-removed row is a benign no-op (not a P2025
  // 500), while a real DB failure now propagates instead of lying about success.
  const row = await db.ticketAsset.findUnique({ where: { ticketId_assetId: { ticketId, assetId } }, select: { ticketId: true } });
  if (!row) return;
  await db.ticketAsset.delete({ where: { ticketId_assetId: { ticketId: row.ticketId, assetId } } });
  revalidatePath(`/tickets/${row.ticketId}`);
}

export async function unlinkRelation(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const ticketId = Number(formData.get("ticketId"));
  const kind = String(formData.get("kind") ?? "");
  if (!ticketId || !["problem", "change"].includes(kind)) return;
  if (!(await ensureCanAct(ticketId, me))) return;
  await db.ticket.update({ where: { id: ticketId }, data: kind === "problem" ? { problemId: null } : { changeId: null } });
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/problems");
  revalidatePath("/changes");
}

/**
 * Attach (or, with an empty value, detach) a ticket to a Problem. Works from
 * either side: the ticket detail page passes its own ticketId + a chosen problemId;
 * the problem detail page passes its own problemId + a chosen ticketId.
 */
export async function setTicketProblem(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const ticketId = Number(formData.get("ticketId"));
  const raw = String(formData.get("problemId") ?? "").trim();
  const problemId = raw && raw !== "none" ? Number(raw) : null;
  if (!ticketId) return;
  if (!(await ensureCanAct(ticketId, me))) return;
  // Validate the target problem exists before linking.
  if (problemId && !(await db.problem.findUnique({ where: { id: problemId }, select: { id: true } }))) return;
  await db.ticket.update({ where: { id: ticketId }, data: { problemId } });
  await writeAudit({
    userId: me.id, action: "UPDATE", entity: "Ticket", entityId: ticketId,
    summary: problemId ? `Linked to ${problemRef(problemId)}` : "Unlinked from problem",
  });
  revalidatePath(`/tickets/${ticketId}`);
  if (problemId) revalidatePath(`/problems/${problemId}`);
  revalidatePath("/problems");
}

/** Attach/detach a ticket to a Change. Symmetric to setTicketProblem. */
export async function setTicketChange(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const ticketId = Number(formData.get("ticketId"));
  const raw = String(formData.get("changeId") ?? "").trim();
  const changeId = raw && raw !== "none" ? Number(raw) : null;
  if (!ticketId) return;
  if (!(await ensureCanAct(ticketId, me))) return;
  // Validate the target change exists before linking.
  if (changeId && !(await db.change.findUnique({ where: { id: changeId }, select: { id: true } }))) return;
  await db.ticket.update({ where: { id: ticketId }, data: { changeId } });
  await writeAudit({
    userId: me.id, action: "UPDATE", entity: "Ticket", entityId: ticketId,
    summary: changeId ? `Linked to ${changeRef(changeId)}` : "Unlinked from change",
  });
  revalidatePath(`/tickets/${ticketId}`);
  if (changeId) revalidatePath(`/changes/${changeId}`);
  revalidatePath("/changes");
}

/** Link an asset (CMDB configuration item) to a ticket. */
export async function linkAsset(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const ticketId = Number(formData.get("ticketId"));
  const assetId = String(formData.get("assetId") ?? "").trim();
  if (!ticketId || !assetId) return;
  if (!(await ensureCanAct(ticketId, me))) return;
  // Validate the target asset exists before linking.
  if (!(await db.asset.findUnique({ where: { id: assetId }, select: { id: true } }))) return;
  await db.ticketAsset.upsert({
    where: { ticketId_assetId: { ticketId, assetId } },
    create: { ticketId, assetId },
    update: {},
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: ticketId, summary: "Linked an asset" });
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath(`/assets/${assetId}`);
}

// ── Tasks ──────────────────────────────────────────────────────────────────

export async function addTask(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const ticketId = Number(formData.get("ticketId"));
  const title = String(formData.get("title") ?? "").trim();
  if (!ticketId || !title) return;
  if (!(await ensureCanAct(ticketId, me))) return;
  const count = await db.task.count({ where: { ticketId } });
  await db.task.create({ data: { ticketId, title, order: count } });
  revalidatePath(`/tickets/${ticketId}`);
}

export async function toggleTask(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const taskId = String(formData.get("taskId"));
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  if (task.ticketId && !(await ensureCanAct(task.ticketId, me))) return;
  await db.task.update({ where: { id: taskId }, data: { done: !task.done } });
  revalidatePath(`/tickets/${task.ticketId}`);
}

export async function deleteTask(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const taskId = String(formData.get("taskId"));
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  if (task.ticketId && !(await ensureCanAct(task.ticketId, me))) return;
  await db.task.delete({ where: { id: taskId } });
  revalidatePath(`/tickets/${task.ticketId}`);
}

// ── Time tracking ────────────────────────────────────────────────────────────

export type WorkLogState = { ok?: boolean; error?: string } | undefined;

export async function addWorkLog(formData: FormData): Promise<WorkLogState> {
  const me = await requireAgent();
  if (!me) return { error: "Not authorised" };
  const ticketId = Number(formData.get("ticketId"));
  const minutes = Math.floor(Number(formData.get("minutes")));
  const note = String(formData.get("note") ?? "").trim() || null;
  const billable = formData.get("billable") === "on";
  // Cap at one year of minutes to stay within a 32-bit Int and reject nonsense.
  if (!ticketId || !Number.isFinite(minutes) || minutes <= 0 || minutes > 60 * 24 * 366) {
    return { error: "Enter a valid number of minutes." };
  }

  // Ensure the ticket exists so a bogus id can't trigger an FK-constraint 500.
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: { id: true, assigneeId: true, groupId: true } });
  if (!ticket) return { error: "Ticket not found." };
  if (!(await canActOnTicket(me, ticket))) return { error: "Not authorised" };

  await db.workLog.create({ data: { ticketId, userId: me.id, minutes, note, billable } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: ticketId, summary: `Logged ${minutes} min` });
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

export async function deleteWorkLog(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const logId = String(formData.get("logId") ?? "");
  const log = await db.workLog.findUnique({ where: { id: logId } });
  if (!log) return;
  // Own entries only (admins may remove any).
  if (log.userId !== me.id && me.role !== "ADMIN") return;
  // No blanket catch: a genuine DB failure must surface, not fake success.
  await db.workLog.delete({ where: { id: logId } });
  revalidatePath(`/tickets/${log.ticketId}`);
}

export async function updateTicketDetails(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = Number(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim();
  if (!id || title.length < 3) return;
  if (!(await ensureCanAct(id, me))) return;

  // Rich description twin when HTML is supplied (e.g. inbound email); otherwise plaintext.
  const rawHtml = formData.get("descriptionHtml");
  const data: Record<string, unknown> = { title };
  if (typeof rawHtml === "string" && rawHtml.trim()) {
    const descriptionHtml = sanitizeCommentHtml(rawHtml);
    data.descriptionHtml = descriptionHtml;
    data.description = htmlToText(descriptionHtml);
  } else {
    data.description = String(formData.get("description") ?? "");
    data.descriptionHtml = null;
  }
  await db.ticket.update({ where: { id }, data });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: "Edited details" });
  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
}

export async function setTicketDueDate(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = Number(formData.get("id"));
  if (!id) return;
  const raw = String(formData.get("dueDate") ?? "").trim();
  const dueDate = raw ? new Date(raw) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) return;
  const exists = await db.ticket.findUnique({ where: { id }, select: { id: true, assigneeId: true, groupId: true } });
  if (!exists) return;
  if (!(await canActOnTicket(me, exists))) return;
  await db.ticket.update({ where: { id }, data: { dueDate } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: dueDate ? "Set due date" : "Cleared due date" });
  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
}

// ── Collaboration: participants & external forward ───────────────────────────

const participantSchema = z.object({
  ticketId: z.coerce.number(),
  userId: z.string().min(1),
});

/** Add someone as a participant (watcher) and notify them — WITHOUT an @mention. */
export async function addParticipant(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const parsed = participantSchema.safeParse({ ticketId: formData.get("ticketId"), userId: formData.get("userId") });
  if (!parsed.success) return;
  const { ticketId, userId } = parsed.data;
  const notifyByEmail = formData.get("notifyByEmail") === "on";
  const note = String(formData.get("note") ?? "").trim();
  if (userId === me.id) return;

  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: { requester: true } });
  if (!ticket) return;
  if (!(await canActOnTicket(me, ticket))) return;
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, isActive: true } });
  if (!target || !target.isActive) return;

  // Participant = portal-visible collaborator (can see + reply in the portal),
  // NOT an internal watcher.
  await db.ticketParticipant.upsert({
    where: { ticketId_userId: { ticketId, userId } },
    create: { ticketId, userId, addedById: me.id },
    update: {},
  });

  await notify(userId, {
    type: "PARTICIPANT_ADDED",
    title: `${me.name} added you to ${ticketRef(ticket.id, ticket.type)}`,
    body: note || ticket.title,
    entity: "Ticket",
    entityId: String(ticketId),
  });
  if (notifyByEmail && target.email) {
    const threadHeaders = await ticketThreadHeaders(ticketId);
    await sendMail({ to: target.email, toName: target.name, entity: "Ticket", entityId: ticketId, ticketId, ...threadHeaders, ...(await tplTicketParticipant(ticket, target.name ?? "there", me.name, note, await mailBrand())) });
  }
  await db.ticketComment.create({
    data: { ticketId, authorId: me.id, isInternal: true, body: `Added ${target.name ?? target.email} as a participant${note ? `: ${note}` : "."}` },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: ticketId, summary: `Added participant ${target.name ?? target.email}` });
  revalidatePath(`/tickets/${ticketId}`);
}


export type ForwardState = { ok?: boolean; error?: string } | undefined;

/**
 * Forward a SINGLE message to an external party (Freshservice-style, per message).
 * The recipient(s) are recorded as Notified contacts so their email reply routes
 * back as an internal note. A distinct "Forwarded" entry is added to the timeline.
 * Privacy: the requester is never a valid forward target here.
 */
export async function forwardComment(_prev: ForwardState, formData: FormData): Promise<ForwardState> {
  const me = await requireAgent();
  if (!me) return { error: "Not authorised" };
  const ticketId = Number(formData.get("ticketId"));
  const commentId = String(formData.get("commentId") ?? "");
  const to = String(formData.get("to") ?? "").trim().toLowerCase();
  const note = String(formData.get("note") ?? "").trim();
  let cc = String(formData.get("cc") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!ticketId || !commentId) return { error: "Missing data." };
  if (!EMAIL_RE.test(to)) return { error: "Please enter a valid email address." };

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, type: true, title: true, assigneeId: true, groupId: true, requester: { select: { email: true } } },
  });
  if (!ticket) return { error: "Ticket not found." };
  // Guard the external-exfiltration path: only ADMIN/MANAGER, the assignee, or a
  // member of the ticket's group may forward this thread off-platform.
  if (!(await canActOnTicket(me, ticket))) return { error: "Not authorised" };
  const comment = await db.ticketComment.findFirst({
    where: { id: commentId, ticketId },
    include: { author: { select: { name: true, email: true } } },
  });
  if (!comment) return { error: "Message not found." };
  if (to === (ticket.requester?.email ?? "").toLowerCase()) {
    return { error: "Use a public reply to contact the requester." };
  }

  const ref = ticketRef(ticket.id, ticket.type);
  const requesterEmail = (ticket.requester?.email ?? "").toLowerCase();
  // The requester must never end up on a forward — that would silently flip their
  // future replies to internal (and leak the internal forward to them). Drop them
  // from the actual Cc (To is guarded above), then from the notified recipients.
  cc = cc.filter((e) => e !== requesterEmail);
  const recipients = [to, ...cc].filter((e) => EMAIL_RE.test(e) && e !== requesterEmail);
  // Record each recipient as a "Notified" contact → their reply routes internal.
  // Skip the requester and existing participants so we never reclassify a
  // customer-side party's replies as internal.
  for (const email of recipients) {
    if (email === requesterEmail) continue;
    const isParticipant = await db.ticketParticipant.findFirst({ where: { ticketId, user: { email } }, select: { userId: true } });
    if (isParticipant) continue;
    await db.ticketNotifiedContact.upsert({
      where: { ticketId_email: { ticketId, email } },
      create: { ticketId, email, notifiedById: me.id },
      update: { notifiedById: me.id },
    });
  }

  // Build the forwarded email: your note + the conversation history UP TO AND
  // INCLUDING this message (public messages only, for privacy), newest first — so
  // the external party gets the whole thread, not just one quoted line.
  const chain = await db.ticketComment.findMany({
    where: { ticketId, isInternal: false, channel: { not: "FORWARD" }, createdAt: { lte: comment.createdAt } },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { author: { select: { name: true, email: true } } },
  });
  const historyHtml = renderThreadHistory(
    chain.map((m) => ({
      author: m.author?.name ?? m.author?.email ?? m.fromEmail ?? "Unknown",
      dateLabel: format(m.createdAt, "dd.MM.yyyy HH:mm"),
      html: m.bodyHtml ?? textToHtmlParagraphs(m.body),
    })),
  );
  const contentHtml = (note ? textToHtmlParagraphs(note) : "") + historyHtml;
  const threadHeaders = await ticketThreadHeaders(ticketId);
  await sendMail({
    to,
    cc,
    entity: "Ticket",
    entityId: ticketId,
    ticketId,
    ...threadHeaders,
    template: "ticket_forward",
    subject: `[${ref}] Fwd: ${ticket.title}`,
    body: htmlToText(contentHtml),
    html: renderEmailHtml({ contentHtml }),
  });

  // Distinct "Forwarded" entry in the timeline (channel FORWARD → indigo style).
  const toLabel = recipients.join(", ");
  await db.ticketComment.create({
    data: {
      ticketId,
      authorId: me.id,
      isInternal: true,
      channel: "FORWARD",
      body: `Forwarded conversation to ${toLabel}${note ? `: ${note}` : "."}`,
      bodyHtml:
        `<p style="margin:0"><strong>Forwarded conversation to ${escapeInlineText(toLabel)}</strong>${note ? ` — ${escapeInlineText(note)}` : ""}</p>`,
    },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: ticketId, summary: `Forwarded a message to ${toLabel}` });
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

export async function setTicketPending(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return refused(NOT_AUTHORISED);
  const id = Number(formData.get("id"));
  const status = String(formData.get("status") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const rawHtml = formData.get("bodyHtml");
  const bodyHtml = typeof rawHtml === "string" && rawHtml.trim() ? sanitizeCommentHtml(rawHtml) : null;
  const note = bodyHtml ? htmlToText(bodyHtml).trim() || null : String(formData.get("note") ?? "").trim() || null;
  const noteInternal = formData.get("isInternal") === "on";
  if (!id || !["PENDING", "ON_HOLD"].includes(status) || !reason) return refused(INVALID_CHANGE);

  const current = await db.ticket.findUnique({ where: { id }, select: { status: true, approvalState: true, pendingSince: true, assigneeId: true, groupId: true } });
  if (!current) return refused(TICKET_NOT_FOUND);
  if (!(await canActOnTicket(me, current))) return refused(NOT_YOUR_TICKET);
  if (!approvalAllowsStatus(current.approvalState, status)) return refused(AWAITING_APPROVAL);
  if (!(await canTransitionConfigured("TICKET", current.status, status, me.role as Role))) return refused(TRANSITION_NOT_ALLOWED);

  await db.ticket.update({
    where: { id },
    data: { status, pendingReason: reason, pendingNote: note, ...pauseData(current) },
  });
  const reasonLabel = reason.replace(/_/g, " ").toLowerCase();
  await db.ticketComment.create({
    data: {
      ticketId: id,
      authorId: me.id,
      isInternal: note ? noteInternal : true,
      body: note ?? `Set to ${status === "ON_HOLD" ? "on hold" : "pending"} (${reasonLabel}).`,
      bodyHtml,
    },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: `Set ${status.toLowerCase()} (${reasonLabel})` });
  await runAutomations("TICKET_UPDATED", id);
  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
  return { ok: true };
}
