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
  tplTicketReceived, tplTicketAssigned, tplTicketReply, tplTicketResolved, tplTicketParticipant,
  quoteHtml, textToHtmlParagraphs, signatureHtml, renderEmailHtml, renderThreadHistory,
} from "@/lib/mail";
import { renderTicketResolvedEmail } from "@/lib/email-templates";
import { ensureSurvey, surveyUrl } from "@/lib/actions/survey";
import { sanitizeCommentHtml, htmlToText, parseMentionIds } from "@/lib/markdown";
import { format } from "date-fns";
import { runAutomations } from "@/lib/automations";
import { autoAssignTicket, isGroupMember } from "@/lib/assignment";
import { canActOnTicket } from "@/lib/authz";
import { assertRequiredCustomFields, entityFieldValues, type CustomFieldDef } from "@/lib/custom-fields";
import {
  slaCreateData, pauseData, resumeData, firstResponseData, statusChangeData, ticketCalendar,
} from "@/lib/sla";
import { canTransitionConfigured } from "@/lib/workflow";
import {
  TICKET_TYPES,
  PRIORITIES,
  IMPACT_URGENCY,
  TICKET_SOURCES,
  ticketRef,
  problemRef,
  changeRef,
  prefixForType,
} from "@/lib/constants";

/** Load a ticket's owner/group and confirm the actor may act on it. Void-returns
 *  (silent abort) match the actions' existing unauthorized behaviour. */
async function ensureCanAct(ticketId: number, me: { id: string; role: string }): Promise<boolean> {
  const t = await db.ticket.findUnique({ where: { id: ticketId }, select: { assigneeId: true, groupId: true } });
  if (!t) return false;
  return canActOnTicket(me, t);
}

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" && v !== "" ? v : null));

const createSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  description: z.string().default(""),
  // Optional rich-text twin (sanitised HTML) — set by callers that have formatted
  // content (e.g. Sable renders the model's markdown), so the description shows
  // paragraphs/lists instead of a wall of text. Falls back to the plaintext.
  descriptionHtml: z.string().nullish(),
  type: z.enum(TICKET_TYPES),
  priority: z.enum(PRIORITIES),
  impact: z.enum(IMPACT_URGENCY),
  urgency: z.enum(IMPACT_URGENCY),
  source: z.enum(TICKET_SOURCES).default("AGENT"),
  requesterId: z.string().min(1, "Requester is required"),
  requestedByUserId: optionalId,
  assigneeId: optionalId,
  groupId: optionalId,
  categoryId: optionalId,
  serviceId: optionalId,
  slaId: optionalId,
  // Optional map of custom-field values (key → string) supplied at creation.
  customFields: z.record(z.string(), z.string()).optional(),
});

export type ActionState = { error?: string; fieldErrors?: Record<string, string[]> } | undefined;

/**
 * Enforce required, currently-visible custom fields for a to-be-created entity.
 * Throws (aborting the create) when a required field is missing so the action's
 * caller surfaces the error instead of silently persisting an incomplete ticket.
 */
async function enforceRequiredCustomFields(
  entityType: "TICKET" | "PROBLEM" | "CHANGE",
  values: Record<string, string> | undefined,
  entity: Record<string, unknown>,
) {
  const defs = await db.customFieldDef.findMany({ where: { entityType, active: true } });
  if (defs.length === 0) return;
  const res = assertRequiredCustomFields(defs as CustomFieldDef[], values ?? {}, entityFieldValues(entity));
  if (!res.ok) throw new Error(res.error);
}

/**
 * Non-redirecting core of ticket creation. Runs the FULL pipeline —
 * SLA deadline stamping, VIP repricing, requester/assignee mail, TICKET_CREATED
 * automations and auto-assign — then returns the created ticket. `createTicket`
 * (the form action) wraps this and adds revalidate + redirect; other callers
 * (e.g. Sable's applyAssistantProposal, which must NOT redirect) call this directly
 * so their tickets are first-class (SLA clock started, routed, notified).
 */
export async function createTicketCore(
  data: z.infer<typeof createSchema>,
  actorId: string,
) {
  // Reject an incomplete ticket up front: required, currently-visible custom
  // fields must be present. Runs against the ticket's built-in values so a field
  // hidden by its visibility conditions isn't enforced.
  const { customFields, ...core } = data;
  await enforceRequiredCustomFields("TICKET", customFields, {
    type: data.type, priority: data.priority, impact: data.impact, urgency: data.urgency,
    source: data.source, categoryId: data.categoryId,
  });

  // Resolve the SLA and stamp response/resolve deadlines at creation time.
  const sla = await slaCreateData({ slaId: data.slaId, serviceId: data.serviceId, priority: data.priority });
  // "Requested on behalf of" only matters when the reporter differs from the
  // requester — collapse a self-request back to null so the UI stays clean.
  const requestedByUserId =
    data.requestedByUserId && data.requestedByUserId !== data.requesterId
      ? data.requestedByUserId
      : null;
  const ticket = await db.ticket.create({
    // `prefix` is fixed here from the initial type and never changes afterwards,
    // so switching the type later leaves the ticket's ref number untouched.
    data: {
      ...core, requestedByUserId, prefix: prefixForType(data.type), ...sla, status: "NEW",
      ...(customFields ? { customFields: JSON.stringify(customFields) } : {}),
    },
    include: { requester: true, assignee: true },
  });

  await writeAudit({ userId: actorId, action: "CREATE", entity: "Ticket", entityId: ticket.id, summary: `Created ticket "${ticket.title}"` });

  // VIP requesters get elevated handling — reprice the SLA against the new priority.
  // If no HIGH SLA resolves, vipSla is {} and the original deadlines are kept.
  if (ticket.requester?.isVip && (ticket.priority === "LOW" || ticket.priority === "MEDIUM")) {
    ticket.priority = "HIGH";
    const vipSla = await slaCreateData({ serviceId: ticket.serviceId, priority: "HIGH" });
    await db.ticket.update({ where: { id: ticket.id }, data: { priority: "HIGH", ...vipSla } });
  }

  // Confirmation to the requester
  const brand = await mailBrand();
  if (ticket.requester?.email) {
    // This confirmation is the ROOT of the ticket's mail thread — its Message-ID
    // is what inbound replies reference back to. Hence ticketId is set.
    await sendMail({ to: ticket.requester.email, toName: ticket.requester.name, entity: "Ticket", entityId: ticket.id, ticketId: ticket.id, ...(await tplTicketReceived(ticket, brand, { requesterName: ticket.requester.name ?? "", messageHtml: ticket.description ? quoteHtml(textToHtmlParagraphs(ticket.description)) : "" })) });
  }
  // Assignment notice
  if (ticket.assignee && ticket.assigneeId !== actorId) {
    await notify(ticket.assigneeId!, { type: "ASSIGNED", title: "Ticket assigned to you", body: ticket.title, entity: "Ticket", entityId: String(ticket.id) });
    if (ticket.assignee.email) {
      await sendMail({ to: ticket.assignee.email, toName: ticket.assignee.name, entity: "Ticket", entityId: ticket.id, ticketId: ticket.id, ...(await tplTicketAssigned(ticket, ticket.assignee.name ?? "there", brand)) });
    }
  }

  await runAutomations("TICKET_CREATED", ticket.id);
  // Auto-assign from the group (after automations may have routed it to a team).
  await autoAssignTicket(ticket.id);

  return ticket;
}

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

const updateSchema = z.object({
  id: z.coerce.number(),
  field: z.enum([
    "status", "priority", "impact", "urgency", "type",
    "assigneeId", "groupId", "categoryId", "serviceId", "slaId",
  ]),
  value: z.string(),
});

export async function updateTicketField(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { id, field, value } = parsed.data;

  const isRelation = field.endsWith("Id");
  const v = isRelation && (value === "none" || value === "") ? null : value;

  // Authorization: only ADMIN/MANAGER, or the assignee / a member of the ticket's
  // group, may mutate a ticket.
  if (!(await ensureCanAct(id, me))) return;

  // Validate String-backed "enum" values against lib/constants.ts so a forged
  // POST can't write an off-list priority/impact/urgency/type.
  const ENUM_FIELDS: Record<string, readonly string[]> = {
    priority: PRIORITIES,
    impact: IMPACT_URGENCY,
    urgency: IMPACT_URGENCY,
    type: TICKET_TYPES,
  };
  if (field in ENUM_FIELDS && !ENUM_FIELDS[field].includes(value)) return;

  const patch: Record<string, unknown> = { [field]: v };
  if (field === "status") {
    const current = await db.ticket.findUnique({
      where: { id },
      include: { sla: { select: { businessCalendarId: true } } },
    });
    if (!current) return;
    // Enforce the configured lifecycle (built-in map + admin overrides + role).
    if (!(await canTransitionConfigured("TICKET", current.status, value, me.role as Role))) return;
    // Shared with the automation engine so both keep the SLA clock consistent.
    Object.assign(patch, statusChangeData(current, value, new Date(), await ticketCalendar(current)));
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
    if (check && !(await check())) return;
  }
  // The assignee must belong to the ticket's group (anyone when there's no group).
  if (field === "assigneeId" && v) {
    const current = await db.ticket.findUnique({ where: { id }, select: { groupId: true } });
    if (current?.groupId && !(await isGroupMember(current.groupId, v))) return;
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
  if (field === "priority" || field === "serviceId" || field === "slaId") {
    const current = await db.ticket.findUnique({
      where: { id },
      select: {
        status: true, priority: true, serviceId: true, slaId: true, firstResponseAt: true,
      },
    });
    if (current && !["RESOLVED", "CLOSED", "CANCELLED"].includes(current.status)) {
      const next = {
        priority: field === "priority" ? value : current.priority,
        serviceId: field === "serviceId" ? v : current.serviceId,
        slaId: field === "slaId" ? v : current.slaId,
      };
      const sla = await slaCreateData({ slaId: next.slaId, serviceId: next.serviceId, priority: next.priority });
      if ("slaId" in sla) {
        // Fresh deadlines anchored to now. Bank (keep) already-accumulated paused
        // time and any current pause anchor untouched; if a first response already
        // landed, freeze the response clock rather than re-opening it.
        Object.assign(patch, sla);
        if (current.firstResponseAt) {
          patch.responseDueAt = null;
        }
      } else if (field === "slaId" && v === null) {
        // Explicitly cleared the SLA → clear the deadlines it drove.
        Object.assign(patch, { responseDueAt: null, resolveDueAt: null, dueAt: null });
      }
    }
  }

  const ticket = await db.ticket.update({
    where: { id },
    data: patch,
    include: { requester: true, assignee: true },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: `Updated ${field}` });

  if (field === "status" && value === "RESOLVED" && ticket.requester?.email) {
    const cc = await ticketCcEmails(ticket.id, [ticket.requester.email, me.email]);
    const threadHeaders = await ticketThreadHeaders(ticket.id);
    await sendMail({ to: ticket.requester.email, toName: ticket.requester.name, cc, entity: "Ticket", entityId: ticket.id, ticketId: ticket.id, ...threadHeaders, ...(await tplTicketResolved(ticket, await mailBrand(), { requesterName: ticket.requester.name ?? "" })) });
  }
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

/**
 * The full "a ticket reply went out" side-effect pipeline for a *just-created*
 * comment: first-response SLA stamping, @mention + watcher notifications, and —
 * for a PUBLIC agent reply — the outbound email to the requester (+ Cc
 * participants) with signature, thread headers and quoted trail. Internal notes
 * only stamp/notify and never email.
 *
 * Exported so both addTicketComment (composer) and applyMacro (macro `add_reply`)
 * drive identical behaviour from one source of truth. Composer-only inputs
 * (explicit To/Cc/Bcc, quote anchor) are optional; when omitted the email falls
 * back to requester + participants, exactly as the composer does with JS off.
 */
export async function deliverTicketReply(opts: {
  ticket: { id: number; title: string; type: string; status: string; requesterId: string; requester?: { email: string | null; name: string | null } | null };
  comment: { id: string };
  author: { id: string; email: string; name: string; role: string };
  body: string;
  bodyHtml: string | null;
  isInternal: boolean;
  hasAttachments?: boolean;
  toRecipients?: FormDataEntryValue | null;
  ccRecipients?: FormDataEntryValue | null;
  bccRecipients?: FormDataEntryValue | null;
  quoteFromCommentId?: string;
}) {
  const { ticket, comment, author: me, body, bodyHtml, isInternal } = opts;
  const id = ticket.id;
  const isPublicAgentReply = !isInternal && me.role !== "USER";

  // Stamp first response on the first PUBLIC agent reply (drives the response SLA).
  // Conditional updateMany(firstResponseAt: null) so only the first writer wins
  // even if two agents reply concurrently.
  if (isPublicAgentReply) {
    const before = await db.ticket.findUnique({ where: { id }, select: { firstResponseAt: true, responseDueAt: true } });
    if (before && !before.firstResponseAt) {
      await db.ticket.updateMany({ where: { id, firstResponseAt: null }, data: firstResponseData(before) });
    }
  }

  const snippet = body.length > 160 ? `${body.slice(0, 157)}…` : body;

  // @mentions → notify. Id-first from chips (data-mention-id, exact + spoof-proof:
  // a forged id matches no user), falling back to plaintext @name for legacy rows.
  const mentionIds = bodyHtml ? parseMentionIds(bodyHtml) : [];
  const mentioned = mentionIds.length
    ? await db.user.findMany({ where: { id: { in: mentionIds } }, select: { id: true, name: true } })
    : await resolveMentions(body);
  for (const u of mentioned) {
    if (u.id === me.id) continue;
    await notify(u.id, { type: "MENTION", title: `${me.name} mentioned you`, body: snippet, entity: "Ticket", entityId: String(id) });
  }

  // Notify watchers of the new activity. Internal notes only announce THAT
  // something happened — no content snippet, so a confidential note never leaks
  // into a watcher's notification feed.
  await notifyWatchers(
    id,
    me.id,
    {
      type: "COMMENT",
      title: `New comment on ${ticketRef(ticket.id, ticket.type)}`,
      body: isInternal ? "(internal note)" : snippet,
      entity: "Ticket",
      entityId: String(id),
    },
  );

  if (!isPublicAgentReply) return;

  const messageHtml = bodyHtml ?? textToHtmlParagraphs(body);

  // Public agent reply → email it. Recipients come from the composer's visible
  // To / Cc / Bcc fields (Freshservice-style); fall back to requester + participants
  // when they aren't provided (macros / non-ticket threads / JS off).
  const toList = parseEmails(opts.toRecipients ?? null);
  const ccList = parseEmails(opts.ccRecipients ?? null);
  const bccList = parseEmails(opts.bccRecipients ?? null);
  const explicit = toList.length > 0;
  const primaryTo = toList[0] ?? ticket.requester?.email ?? null;
  if (!primaryTo) return;

  const drop = new Set([primaryTo.toLowerCase(), me.email.toLowerCase()]);
  const rawCc = explicit ? [...toList.slice(1), ...ccList] : await ticketCcEmails(ticket.id, [ticket.requester?.email, me.email]);
  const cc = [...new Set(rawCc.map((e) => e.toLowerCase()))].filter((e) => !drop.has(e));
  const bcc = [...new Set(bccList.map((e) => e.toLowerCase()))].filter((e) => !drop.has(e) && !cc.includes(e));

  // Everyone on To/Cc (except the requester) becomes a portal participant so the
  // thread is shared + the recipient list is remembered. Skips forward-only
  // "notified" contacts to preserve their privacy.
  await addReplyParticipants(ticket.id, [primaryTo, ...cc], me.id, ticket.requesterId);

  const atts = opts.hasAttachments
    ? await db.attachment.findMany({ where: { commentId: comment.id }, select: { filename: true, storageKey: true } })
    : [];
  // Append the agent's signature to the OUTGOING email only.
  const author = await db.user.findUnique({ where: { id: me.id }, select: { signature: true, signatureEnabled: true } });
  const signatureText = author?.signatureEnabled && author.signature ? htmlToText(author.signature) : undefined;
  const sigHtml = signatureText ? signatureHtml(textToHtmlParagraphs(signatureText)) : "";
  const threadHeaders = await ticketThreadHeaders(ticket.id);
  const brand = await mailBrand();
  // Quoted conversation trail for the OUTGOING email only (mail-client style) —
  // the stored comment stays clean since the thread is visible in the ticket.
  const quoteHtml = await buildReplyQuote(ticket.id, opts.quoteFromCommentId ?? "", comment.id);
  await sendMail({
    to: primaryTo,
    toName: primaryTo.toLowerCase() === (ticket.requester?.email ?? "").toLowerCase() ? ticket.requester?.name : null,
    cc,
    bcc,
    entity: "Ticket",
    entityId: ticket.id,
    ticketId: ticket.id,
    commentId: comment.id,
    ...threadHeaders,
    ...(await tplTicketReply(ticket, { requesterName: ticket.requester?.name ?? "", messageHtml, signatureHtml: sigHtml, quoteHtml, snippet }, brand)),
    attachments: atts.flatMap((a) => (a.storageKey ? [{ filename: a.filename, storageKey: a.storageKey }] : [])),
  });
}

// ── Collaboration helpers ──────────────────────────────────────────────────

const PRIORITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

async function notifyWatchers(
  ticketId: number,
  exclude: string | null,
  n: { type?: string; title: string; body?: string; entity?: string; entityId?: string },
) {
  const watchers = await db.ticketWatcher.findMany({ where: { ticketId }, select: { userId: true } });
  await Promise.all(
    watchers.filter((w) => w.userId !== exclude).map((w) => notify(w.userId, n)),
  );
}

/**
 * PARTICIPANT emails to CC on an outbound ticket reply, so the whole conversation
 * stays in one thread for everyone on the customer side. Participants (e.g. a
 * CC'd manager) are portal-visible collaborators — distinct from internal watchers.
 * Excludes the requester (they're the To recipient) and any address in `exclude`.
 */
async function ticketCcEmails(ticketId: number, exclude: (string | null | undefined)[] = []): Promise<string[]> {
  const participants = await db.ticketParticipant.findMany({
    where: { ticketId },
    select: { user: { select: { email: true } } },
  });
  const skip = new Set(exclude.filter(Boolean).map((e) => e!.toLowerCase()));
  const out = new Set<string>();
  for (const p of participants) {
    const e = p.user?.email;
    if (e && !skip.has(e.toLowerCase())) out.add(e);
  }
  return [...out];
}

function escapeInlineText(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Quoted conversation trail up to (and including) an anchor comment, appended to
 * the OUTGOING reply email (mail-client style). Public messages only, newest
 * first. Empty when there's no anchor or nothing to quote.
 */
async function buildReplyQuote(ticketId: number, anchorCommentId: string, excludeCommentId: string): Promise<string> {
  if (!anchorCommentId) return "";
  const anchor = await db.ticketComment.findFirst({ where: { id: anchorCommentId, ticketId }, select: { createdAt: true } });
  if (!anchor) return "";
  const chain = await db.ticketComment.findMany({
    where: {
      ticketId,
      isInternal: false,
      channel: { not: "FORWARD" },
      id: { not: excludeCommentId },
      createdAt: { lte: anchor.createdAt },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { author: { select: { name: true, email: true } } },
  });
  if (!chain.length) return "";
  return renderThreadHistory(
    chain.map((m) => ({
      author: m.author?.name ?? m.author?.email ?? m.fromEmail ?? "Unknown",
      dateLabel: format(m.createdAt, "dd.MM.yyyy HH:mm"),
      html: m.bodyHtml ?? textToHtmlParagraphs(m.body),
    })),
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parse a comma-separated hidden field into a list of valid, lower-cased emails. */
function parseEmails(v: FormDataEntryValue | null): string[] {
  return String(v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => EMAIL_RE.test(s));
}

/**
 * Everyone on a public reply's To/Cc becomes a portal participant, so the whole
 * conversation is shared and the recipient list is remembered. Unknown addresses
 * are created as lightweight, INACTIVE contacts (participant-only: they can be
 * emailed and appear on the thread, but can't sign in — a real account is minted
 * only through the proper invite/sync flow). Forward-only "notified" contacts and
 * the requester/actor are skipped.
 */
async function addReplyParticipants(ticketId: number, emails: string[], actorId: string, requesterId: string) {
  for (const email of [...new Set(emails.map((e) => e.toLowerCase()))]) {
    if (!EMAIL_RE.test(email)) continue;
    const notified = await db.ticketNotifiedContact.findUnique({
      where: { ticketId_email: { ticketId, email } },
      select: { id: true },
    });
    if (notified) continue;
    let user = await db.user.findUnique({ where: { email }, select: { id: true } });
    // Auto-provisioned from an outbound recipient → inactive contact, not an
    // active login. This avoids silently creating usable accounts for arbitrary
    // addresses an agent CC's.
    if (!user) user = await db.user.create({ data: { email, name: email.split("@")[0], role: "USER", isActive: false }, select: { id: true } });
    if (user.id === actorId || user.id === requesterId) continue;
    await db.ticketParticipant.upsert({
      where: { ticketId_userId: { ticketId, userId: user.id } },
      create: { ticketId, userId: user.id, addedById: actorId },
      update: {},
    });
  }
}

/** Find users referenced with @Name / @email in a comment body. */
async function resolveMentions(body: string) {
  const tokens = body.match(/@([\w.@-]{2,})/g)?.map((t) => t.slice(1).toLowerCase()) ?? [];
  if (tokens.length === 0) return [];
  const users = await db.user.findMany({ select: { id: true, name: true, email: true } });
  return users.filter((u) => {
    const first = (u.name ?? "").split(" ")[0].toLowerCase();
    const handle = (u.name ?? "").toLowerCase().replace(/\s+/g, "");
    const email = u.email.toLowerCase();
    const emailLocal = email.split("@")[0];
    return tokens.some((tk) => tk === first || tk === handle || tk === email || tk === emailLocal);
  });
}

// ── Ticket actions ─────────────────────────────────────────────────────────

export async function escalateTicket(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = Number(formData.get("id"));
  if (!id) return;
  const t = await db.ticket.findUnique({ where: { id } });
  if (!t) return;
  if (!(await canActOnTicket(me, t))) return;
  const next = PRIORITY_ORDER[Math.min(PRIORITY_ORDER.indexOf(t.priority as (typeof PRIORITY_ORDER)[number]) + 1, 3)];
  // Route the implicit NEW→OPEN through the configured lifecycle instead of
  // forcing it; if the transition isn't allowed for this role, leave status as-is.
  const toOpen = t.status === "NEW" && (await canTransitionConfigured("TICKET", "NEW", "OPEN", me.role as Role));
  // A priority change re-prices the SLA — same contract as updateTicketField,
  // so the deadlines track the new tier instead of going stale.
  const sla = !["RESOLVED", "CLOSED", "CANCELLED"].includes(t.status)
    ? await slaCreateData({ serviceId: t.serviceId, priority: next })
    : {};
  await db.ticket.update({ where: { id }, data: { priority: next, status: toOpen ? "OPEN" : t.status, ...sla } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: `Escalated priority to ${next}` });
  if (t.assigneeId) await notify(t.assigneeId, { type: "ESCALATION", title: `Ticket escalated to ${next}`, body: t.title, entity: "Ticket", entityId: String(id) });
  await notifyWatchers(id, me.id, { type: "ESCALATION", title: `Ticket escalated to ${next}`, body: t.title, entity: "Ticket", entityId: String(id) });
  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
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
  const sla = now && !["RESOLVED", "CLOSED", "CANCELLED"].includes(t.status)
    ? await slaCreateData({ serviceId: t.serviceId, priority: "CRITICAL" })
    : {};
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

export async function toggleWatch(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = Number(formData.get("id"));
  if (!id) return;
  const existing = await db.ticketWatcher.findUnique({ where: { ticketId_userId: { ticketId: id, userId: me.id } } });
  if (existing) await db.ticketWatcher.delete({ where: { ticketId_userId: { ticketId: id, userId: me.id } } });
  else await db.ticketWatcher.create({ data: { ticketId: id, userId: me.id } });
  revalidatePath(`/tickets/${id}`);
}

export async function linkTicket(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = Number(formData.get("id"));
  const targetId = Number(formData.get("targetId"));
  const type = String(formData.get("type") || "RELATED");
  if (!id || !targetId || id === targetId) return;
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

export async function unlinkTicket(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const linkId = String(formData.get("linkId"));
  const ticketId = Number(formData.get("ticketId"));
  if (!linkId) return;
  if (ticketId && !(await ensureCanAct(ticketId, me))) return;
  await db.ticketLink.delete({ where: { id: linkId } }).catch(() => {});
  revalidatePath(`/tickets/${ticketId}`);
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
    select: { id: true, mergedIntoId: true, status: true },
  });
  if (!target || target.status === "CANCELLED") return;
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
    await tx.ticket.update({ where: { id }, data: { mergedIntoId: targetId, status: "CANCELLED", closedAt: new Date() } });
    await tx.ticketComment.create({ data: { ticketId: id, authorId: me.id, isInternal: true, body: `Merged into ${ticketRef(targetId)}. Comments, watchers and assets were carried over.` } });
    await tx.ticketLink.upsert({
      where: { ticketId_linkedTicketId: { ticketId: targetId, linkedTicketId: id } },
      create: { ticketId: targetId, linkedTicketId: id, type: "DUPLICATE" },
      update: { type: "DUPLICATE" },
    });
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: `Merged into ${ticketRef(targetId)}` });

  revalidatePath(`/tickets/${id}`);
  revalidatePath(`/tickets/${targetId}`);
  redirect(`/tickets/${targetId}`);
}

// ── Resolution / cancel ──────────────────────────────────────────────────────

export async function setTicketResolution(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = Number(formData.get("id"));
  const status = String(formData.get("status") ?? "");
  const code = String(formData.get("code") ?? "").trim() || null;
  const rawHtml = formData.get("bodyHtml");
  const bodyHtml = typeof rawHtml === "string" && rawHtml.trim() ? sanitizeCommentHtml(rawHtml) : null;
  const note = bodyHtml ? htmlToText(bodyHtml).trim() || null : String(formData.get("note") ?? "").trim() || null;
  const noteInternal = formData.get("isInternal") === "on";
  if (!id || !["RESOLVED", "CLOSED", "CANCELLED"].includes(status)) return;

  const current = await db.ticket.findUnique({
    where: { id },
    include: { sla: { select: { businessCalendarId: true } } },
  });
  if (!current) return;
  if (!(await canActOnTicket(me, current))) return;
  if (!(await canTransitionConfigured("TICKET", current.status, status, me.role as Role))) return;

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
  } else if (current.pendingSince) {
    // CLOSED/CANCELLED from a paused state: just clear the anchor + bank paused time,
    // no point shifting deadlines on a terminal, non-resolved ticket.
    clock.pendingSince = null;
    clock.pausedMs = current.pausedMs + Math.max(0, now.getTime() - current.pendingSince.getTime());
  }

  const ticket = await db.ticket.update({
    where: { id },
    data: {
      status,
      resolutionCode: status === "CANCELLED" ? null : code,
      resolutionNote: note,
      resolvedAt: status === "RESOLVED" ? now : undefined,
      closedAt: status === "CLOSED" || status === "CANCELLED" ? now : undefined,
      ...clock,
    },
    include: { requester: true },
  });

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

  if (status === "RESOLVED") {
    // CSAT: mint (or reuse) a survey token for this ticket and, if we're emailing
    // the requester, ride the "Rate our support" link along with the resolution.
    const surveyToken = await ensureSurvey(id);
    if (ticket.requester?.email) {
      const link = surveyToken ? await surveyUrl(surveyToken) : null;
      await sendMail({
        to: ticket.requester.email, toName: ticket.requester.name,
        entity: "Ticket", entityId: id, ticketId: id,
        ...(await renderTicketResolvedEmail({
          brand: await mailBrand(),
          ref: ticketRef(ticket.id, ticket.type),
          title: ticket.title,
          requesterName: ticket.requester.name ?? "",
          surveyUrl: link,
        })),
      });
    }
  }
  await runAutomations("TICKET_UPDATED", id);
  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
}

// ── Unlink relations ─────────────────────────────────────────────────────────

export async function unlinkAsset(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const ticketId = Number(formData.get("ticketId"));
  const assetId = String(formData.get("assetId") ?? "");
  if (!ticketId || !assetId) return;
  if (!(await ensureCanAct(ticketId, me))) return;
  await db.ticketAsset.delete({ where: { ticketId_assetId: { ticketId, assetId } } }).catch(() => {});
  revalidatePath(`/tickets/${ticketId}`);
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
  await db.workLog.delete({ where: { id: logId } }).catch(() => {});
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

export async function setTicketPending(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = Number(formData.get("id"));
  const status = String(formData.get("status") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const rawHtml = formData.get("bodyHtml");
  const bodyHtml = typeof rawHtml === "string" && rawHtml.trim() ? sanitizeCommentHtml(rawHtml) : null;
  const note = bodyHtml ? htmlToText(bodyHtml).trim() || null : String(formData.get("note") ?? "").trim() || null;
  const noteInternal = formData.get("isInternal") === "on";
  if (!id || !["PENDING", "ON_HOLD"].includes(status) || !reason) return;

  const current = await db.ticket.findUnique({ where: { id }, select: { status: true, pendingSince: true, assigneeId: true, groupId: true } });
  if (!current) return;
  if (!(await canActOnTicket(me, current))) return;
  if (!(await canTransitionConfigured("TICKET", current.status, status, me.role as Role))) return;

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
}
