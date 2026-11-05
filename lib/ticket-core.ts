import "server-only";

import { z } from "zod";
import { format } from "date-fns";
import { db } from "@/lib/db";
import { writeAudit, notify } from "@/lib/audit";
import {
  sendMail, ticketThreadHeaders, mailBrand,
  tplTicketReceived, tplTicketAssigned, tplTicketReply,
  quoteHtml, textToHtmlParagraphs, signatureHtml, renderThreadHistory,
} from "@/lib/mail";
import { htmlToText, parseMentionIds } from "@/lib/markdown";
import { runAutomations } from "@/lib/automations";
import { autoAssignTicket } from "@/lib/assignment";
import { canTransitionConfigured } from "@/lib/workflow";
import { assertRequiredCustomFields, entityFieldValues, type CustomFieldDef } from "@/lib/custom-fields";
import { slaCreateData, slaRepricePatch, firstResponseData, customerReplyReopenData } from "@/lib/sla";
import {
  TICKET_TYPES,
  PRIORITIES,
  IMPACT_URGENCY,
  TICKET_SOURCES,
  ticketRef,
  prefixForType,
} from "@/lib/constants";

/**
 * Server-side ticket core pipelines, deliberately NOT part of a "use server"
 * module: every export of a "use server" file is an unauthenticated public HTTP
 * endpoint. These functions perform privileged work (full ticket creation,
 * outbound reply delivery) and trust their caller to have authorized the actor —
 * so they may only be imported and invoked from guarded server code (the
 * `createTicket` action, inbound-mail ingestion, AI flows, macros), never
 * exposed as actions themselves.
 */

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" && v !== "" ? v : null));

export const createSchema = z.object({
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

/** Canonical ticket-link relation types (mirrors schema.prisma TicketLink.type). */
export const TICKET_LINK_TYPES = ["RELATED", "DUPLICATE", "BLOCKS", "CAUSED_BY"] as const;

/** Typed result for actions whose dialogs surface errors to the user. */
export type TicketActionResult = { ok: boolean; error?: string };

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
 *
 * SECURITY: intentionally not exported from any "use server" module — the actor
 * id is trusted attribution supplied by an authenticated caller, never by the wire.
 */
export async function createTicketCore(
  data: z.infer<typeof createSchema>,
  actorId: string,
  /** Message-ID of the customer email that opened the ticket, so the confirmation threads onto it. */
  sourceMessageId?: string | null,
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
    const vipSla = await slaRepricePatch(ticket, { priority: "HIGH", serviceId: ticket.serviceId, slaId: ticket.slaId });
    await db.ticket.update({ where: { id: ticket.id }, data: { priority: "HIGH", ...vipSla } });
  }

  // Confirmation to the requester
  const brand = await mailBrand();
  if (ticket.requester?.email) {
    // This confirmation is the ROOT of the ticket's mail thread — its Message-ID
    // is what inbound replies reference back to. Hence ticketId is set.
    const threadOnSource = sourceMessageId ? { inReplyTo: sourceMessageId, references: sourceMessageId } : {};
    await sendMail({ to: ticket.requester.email, toName: ticket.requester.name, entity: "Ticket", entityId: ticket.id, ticketId: ticket.id, ...threadOnSource, ...(await tplTicketReceived(ticket, brand, { requesterName: ticket.requester.name ?? "", messageHtml: ticket.description ? quoteHtml(textToHtmlParagraphs(ticket.description)) : "" })) });
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parse a comma-separated hidden field into a list of valid, lower-cased emails. */
function parseEmails(v: FormDataEntryValue | null): string[] {
  return String(v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => EMAIL_RE.test(s));
}

export async function notifyWatchers(
  ticketId: number,
  exclude: string | null,
  n: { type?: string; title: string; body?: string; entity?: string; entityId?: string },
) {
  const watchers = await db.ticketWatcher.findMany({ where: { ticketId }, select: { userId: true } });
  await Promise.all(
    watchers.filter((w) => w.userId !== exclude).map((w) => notify(w.userId, n)),
  );
}

/** Notify the ticket's assignee and watchers (once each), except `exclude`. */
export async function notifyAssigneeAndWatchers(
  ticketId: number,
  exclude: string,
  n: { type?: string; title: string; body?: string; entity?: string; entityId?: string },
) {
  const [ticket, watchers] = await Promise.all([
    db.ticket.findUnique({ where: { id: ticketId }, select: { assigneeId: true } }),
    db.ticketWatcher.findMany({ where: { ticketId }, select: { userId: true } }),
  ]);
  const recipients = new Set(watchers.map((w) => w.userId));
  if (ticket?.assigneeId) recipients.add(ticket.assigneeId);
  recipients.delete(exclude);
  await Promise.all([...recipients].map((uid) => notify(uid, n)));
}

/**
 * A requester-side reply (portal or email) arrived: reopen a RESOLVED/CLOSED
 * ticket so it lands back in the agent queue, and bump its activity timestamp.
 * Returns true when the ticket was reopened. The caller has authorised `actorId`.
 */
export async function reopenOnCustomerReply(ticketId: number, actorId: string): Promise<boolean> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: {
      status: true, resolutionCode: true, resolutionNote: true,
      responseDueAt: true, resolveDueAt: true, dueAt: true, pendingSince: true, pausedMs: true,
    },
  });
  if (!ticket) return false;
  const reopen = customerReplyReopenData(ticket);
  const allowed = reopen !== null && (await canTransitionConfigured("TICKET", ticket.status, "OPEN", "USER"));
  if (!allowed) {
    await db.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
    return false;
  }
  // Conditional write: an agent's status change between the read and this write wins.
  const { count } = await db.ticket.updateMany({
    where: { id: ticketId, status: ticket.status },
    data: { ...reopen, updatedAt: new Date() },
  });
  if (count === 0) return false;
  // The resolution note stays in the comment thread; keep the cleared code in the audit trail.
  const was = ticket.resolutionCode ? `${ticket.status}, ${ticket.resolutionCode}` : ticket.status;
  await writeAudit({
    userId: actorId, action: "UPDATE", entity: "Ticket", entityId: ticketId,
    summary: `Reopened by requester reply (was ${was})`,
  });
  return true;
}

/**
 * PARTICIPANT emails to CC on an outbound ticket reply, so the whole conversation
 * stays in one thread for everyone on the customer side. Participants (e.g. a
 * CC'd manager) are portal-visible collaborators — distinct from internal watchers.
 * Excludes the requester (they're the To recipient) and any address in `exclude`.
 */
async function ticketCcEmailsInternal(ticketId: number, exclude: (string | null | undefined)[] = []): Promise<string[]> {
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

/**
 * The full "a ticket reply went out" side-effect pipeline for a *just-created*
 * comment: first-response SLA stamping, @mention + watcher notifications, and —
 * for a PUBLIC agent reply — the outbound email to the requester (+ Cc
 * participants) with signature, thread headers and quoted trail. Internal notes
 * only stamp/notify and never email.
 *
 * Shared by addTicketComment (composer) and applyMacro (macro `add_reply`) so
 * both drive identical behaviour from one source of truth. Composer-only inputs
 * (explicit To/Cc/Bcc, quote anchor) are optional; when omitted the email falls
 * back to requester + participants, exactly as the composer does with JS off.
 *
 * SECURITY: intentionally not exported from any "use server" module — sending
 * arbitrary outbound email as the service desk requires an authorized,
 * authenticated caller (this module refuses direct HTTP exposure).
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
  const rawCc = explicit ? [...toList.slice(1), ...ccList] : await ticketCcEmailsInternal(ticket.id, [ticket.requester?.email, me.email]);
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
  const quotedTrail = await buildReplyQuote(ticket.id, opts.quoteFromCommentId ?? "", comment.id);
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
    ...(await tplTicketReply(ticket, { requesterName: ticket.requester?.name ?? "", messageHtml, signatureHtml: sigHtml, quoteHtml: quotedTrail, snippet }, brand)),
    attachments: atts.flatMap((a) => (a.storageKey ? [{ filename: a.filename, storageKey: a.storageKey }] : [])),
  });
}

// SLA re-pricing lives in lib/sla.ts (automations need it too and cannot import this module).
export { slaRepricePatch } from "@/lib/sla";

/** Participant CC lookup shared with the reply pipeline (used by updateTicketField's resolve mail). */
export async function ticketCcEmails(ticketId: number, exclude: (string | null | undefined)[] = []): Promise<string[]> {
  return ticketCcEmailsInternal(ticketId, exclude);
}

export { EMAIL_RE };
