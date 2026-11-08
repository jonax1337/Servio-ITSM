"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prisma, TicketMerge } from "@prisma/client";
import { db } from "@/lib/db";
import { type Role, requireAgentUser } from "@/lib/session";
import { writeAudit, notify } from "@/lib/audit";

/** Only agents/managers/admins may act on the agent console. */
async function requireAgent() {
  // DB-truth guard (role + isActive rehydrated) — see requireAgentUser.
  return requireAgentUser();
}
import {
  sendMail, ticketThreadHeaders, forwardThreadHeaders, FORWARD_TEMPLATE, mailBrand,
  tplTicketAssigned, tplTicketParticipant,
  textToHtmlParagraphs, renderEmailHtml, renderThreadHistory,
} from "@/lib/mail";
import { renderTicketResolvedEmail } from "@/lib/email-templates";
import { ensureSurvey, surveyUrl } from "@/lib/csat-survey";
import { sanitizeCommentHtml, htmlToText } from "@/lib/markdown";
import { format } from "date-fns";
import { runAutomations } from "@/lib/automations";
import { autoAssignTicket, isGroupMember } from "@/lib/assignment";
import { canActOnTicket, mayActOnTicket } from "@/lib/authz";
import { ensureDraftStatusIncident, notifyOnCallOfMajorIncident } from "@/lib/status-incidents";
import { withdrawPendingApprovals } from "@/lib/approval-seating";
import {
  firstResponseData, pauseData, resumeData, statusChangeData, ticketCalendar,
} from "@/lib/sla";
import { canTransitionConfigured } from "@/lib/workflow";
import {
  BULK_CLEAR, bulkSkipDetail, buildBulkChanges, planBulkTicket, withApplyResult, type BulkApplyResult, type BulkChange, type BulkOutcome, type BulkRules, type BulkTicketState,
} from "@/lib/bulk-edit";
import { ASSIGNEE_NOT_IN_GROUP, AWAITING_APPROVAL, NOT_YOUR_TICKET, TRANSITION_NOT_ALLOWED } from "@/lib/ticket-refusals";
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
  MAX_HIERARCHY_DEPTH, ancestorChain, openChildren, parentLinkRefusal, subtreeHeight, type RefusedChild,
} from "@/lib/ticket-hierarchy-rules";
import {
  MERGE_REFUSALS, adoptedId, foreignRequesterLabel, mergeDepthRefusal, mergedStatusRefusal, mergeRefusal, mergeTargetRefusal,
  missingFrom, parseMovedAttachments, parseNumberIds, parseStringIds, planAttachmentRestore, planChildRestore,
  planCommentCopy, planMergeLinks, undoClockData, unmergeRefusal, type MovedAttachment,
} from "@/lib/merge-rules";
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
  /** Compare-and-set: write only while the field still holds this value ("none" = empty). Undo sends it. */
  expected: z.string().optional(),
});

export async function updateTicketField(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return refused(NOT_AUTHORISED);
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refused(INVALID_CHANGE);
  const { id, field, value, expected } = parsed.data;
  const isUndo = expected !== undefined;

  const isRelation = field.endsWith("Id");
  const asStored = (raw: string) => (isRelation && (raw === "none" || raw === "") ? null : raw);
  const v = asStored(value);

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
    const mergedRefusal = mergedStatusRefusal(current, value);
    if (mergedRefusal) return refused(mergedRefusal);
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
  // A new owner gets their own SLA nudge.
  if ("assigneeId" in patch) patch.slaNudgedAt = null;

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

  // One conditional statement, so the check and the write cannot be split by another edit.
  const written = await db.ticket.updateMany({
    where: { id, ...(isUndo && { [field]: asStored(expected) }) },
    data: patch,
  });
  if (written.count === 0) return refused(isUndo ? CHANGED_SINCE : TICKET_NOT_FOUND);
  const ticket = await db.ticket.findUniqueOrThrow({ where: { id }, include: { requester: true, assignee: true } });
  await withdrawPendingApprovals(id, patch);
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: `Updated ${field}` });

  if (field === "status" && value === "RESOLVED") await sendResolvedMail(ticket, me.email, null);
  if (field === "assigneeId" && ticket.assignee?.email && ticket.assigneeId !== me.id) {
    await notify(ticket.assigneeId!, { type: "ASSIGNED", title: "Ticket assigned to you", body: ticket.title, entity: "Ticket", entityId: String(ticket.id) });
    await sendMail({ to: ticket.assignee.email, toName: ticket.assignee.name, entity: "Ticket", entityId: ticket.id, ticketId: ticket.id, ...(await tplTicketAssigned(ticket, ticket.assignee.name ?? "there", await mailBrand(ticket.assignee))) });
  }

  // An Undo puts back a state the user already saw: re-running routing would overwrite it,
  // e.g. auto-assign a member before the previous assignee is restored.
  if (!isUndo) {
    await runAutomations("TICKET_UPDATED", id);
    // After automations may have (re)routed the ticket to a team, auto-assign it
    // (no-op if it already has an assignee or the team has no strategy).
    if (field === "groupId" && v) await autoAssignTicket(id);
  }

  revalidatePath(`/tickets/${id}`);
  revalidatePath("/tickets");
  return { ok: true };
}

/**
 * Apply a multi-field edit (`patch`: JSON of status / priority / group / assignee /
 * category, see lib/bulk-edit.ts) to many tickets at once. Every ticket is checked
 * against the whole patch first and skipped, with its reason, when any field would be
 * refused. The writes then go through updateTicketField per ticket and field, so
 * authorization, transitions, the SLA clock, audit, automations and notifications all
 * still run. Automations can re-route a ticket between two writes; when that makes a
 * later field refuse, the ticket is reported as partially updated rather than skipped.
 */
export async function bulkUpdateTickets(formData: FormData): Promise<BulkUpdateResult> {
  const me = await requireAgent();
  if (!me) return { ok: false, ...NOTHING_CHANGED, error: NOT_AUTHORISED };
  const ids = [...new Set(String(formData.get("ids") ?? "").split(",").map((s) => Number(s.trim())))]
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 200);
  const changes = buildBulkChanges(parseJson(formData.get("patch")));
  if (!ids.length || !changes.length || !(await bulkTargetsExist(changes))) {
    return { ok: false, ...NOTHING_CHANGED, error: INVALID_CHANGE };
  }

  const tickets = await db.ticket.findMany({
    where: { id: { in: ids } },
    select: { id: true, prefix: true, status: true, groupId: true, assigneeId: true, approvalState: true, mergedIntoId: true },
  });
  const rules = await loadBulkRules(me, tickets, changes);
  let outcome: BulkOutcome = NOTHING_CHANGED;

  const found = new Set(tickets.map((t) => t.id));
  for (const id of ids.filter((id) => !found.has(id))) {
    outcome = withApplyResult(outcome, ticketRef(id), { applied: 0, refusal: TICKET_NOT_FOUND });
  }
  for (const ticket of tickets) {
    const planned = planBulkTicket(ticket, changes, rules);
    const result = planned ? { applied: 0, refusal: planned } : await applyChanges(ticket.id, changes);
    outcome = withApplyResult(outcome, ticketRef(ticket.id, ticket.prefix), result);
  }
  revalidatePath("/tickets");
  const ok = outcome.updated > 0 || outcome.partial.length > 0;
  return { ok, ...outcome, ...(!ok && { error: bulkSkipDetail(outcome.skipped) }) };
}

const NOTHING_CHANGED: BulkOutcome = { updated: 0, partial: [], skipped: [] };

export type BulkUpdateResult = TicketActionResult & BulkOutcome;

/** Whether every group, agent and category a bulk patch points at exists. */
async function bulkTargetsExist(changes: BulkChange[]): Promise<boolean> {
  const count: Partial<Record<BulkChange["field"], (id: string) => Promise<number>>> = {
    groupId: (id) => db.group.count({ where: { id } }),
    assigneeId: (id) => db.user.count({ where: { id } }),
    categoryId: (id) => db.category.count({ where: { id } }),
  };
  for (const { field, value } of changes) {
    if (value !== BULK_CLEAR && count[field] && (await count[field](value)) === 0) return false;
  }
  return true;
}

/** The access, membership and workflow facts a bulk edit checks, read once for the whole batch. */
async function loadBulkRules(
  me: Agent,
  tickets: readonly (BulkTicketState & { id: number })[],
  changes: readonly BulkChange[],
): Promise<BulkRules> {
  const target = (field: BulkChange["field"]) => changes.find((c) => c.field === field && c.value !== BULK_CLEAR)?.value;
  const groupIds = new Set([...tickets.map((t) => t.groupId), target("groupId")].filter((id): id is string => !!id));
  const userIds = new Set([...tickets.map((t) => t.assigneeId), target("assigneeId"), me.id].filter((id): id is string => !!id));
  const memberships = await db.groupMember.findMany({
    where: { groupId: { in: [...groupIds] }, userId: { in: [...userIds] } },
    select: { groupId: true, userId: true },
  });
  const members = new Set(memberships.map((m) => `${m.groupId}:${m.userId}`));
  const isMember = (groupId: string, userId: string) => members.has(`${groupId}:${userId}`);

  const nextStatus = changes.find((c) => c.field === "status")?.value;
  const transitions = new Map<string, boolean>();
  if (nextStatus) {
    for (const from of new Set(tickets.map((t) => t.status))) {
      transitions.set(from, await canTransitionConfigured("TICKET", from, nextStatus, me.role as Role));
    }
  }
  return {
    canAct: (state) => mayActOnTicket(me, state, isMember),
    isMember,
    statusRefusal(state, to) {
      const merged = mergedStatusRefusal(state, to);
      if (merged) return merged;
      if (!approvalAllowsStatus(state.approvalState, to)) return AWAITING_APPROVAL;
      return transitions.get(state.status) === false ? TRANSITION_NOT_ALLOWED : null;
    },
  };
}

function parseJson(raw: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(String(raw ?? ""));
  } catch {
    return null;
  }
}

/** Runs the changes on one ticket in order, stopping at the first refusal. */
async function applyChanges(ticketId: number, changes: BulkChange[]): Promise<BulkApplyResult> {
  let applied = 0;
  for (const { field, value } of changes) {
    const fd = new FormData();
    fd.set("id", String(ticketId));
    fd.set("field", field);
    fd.set("value", value);
    const result = await updateTicketField(fd);
    if (!result.ok) return { applied, refusal: result.error ?? INVALID_CHANGE };
    applied++;
  }
  return { applied, refusal: null };
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
const TICKET_NOT_FOUND = "Ticket not found.";
const CHANGED_SINCE = "This field changed since — not undone.";
const INVALID_CHANGE = "That change isn't valid for this ticket.";
const INVALID_LINK = "That link request isn't valid.";
const ALREADY_LINKED = "These tickets are already linked.";
const refused = (error: string): TicketActionResult => ({ ok: false, error });

/** The ticket's display reference, keyed by its stored prefix (stable after a type switch). */
const refOf = (t: { id: number; type: string; prefix: string | null }) => ticketRef(t.id, t.prefix || t.type);

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
      brand: await mailBrand(ticket.requester),
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
    // The declaration is already persisted; a failing side effect must not fail the toggle.
    try {
      await ensureDraftStatusIncident(t, me.id);
      await notifyOnCallOfMajorIncident(t, me.id);
    } catch (e) {
      console.error("[servio:status] major-incident follow-ups failed", e);
    }
    revalidatePath("/status");
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

export async function linkTicket(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return refused(NOT_AUTHORISED);
  const id = Number(formData.get("id"));
  const targetId = Number(formData.get("targetId"));
  const type = String(formData.get("type") || "RELATED");
  if (!id || !targetId) return refused(INVALID_LINK);
  if (id === targetId) return refused("A ticket can't be linked to itself.");
  // Validate the link type against the canonical tuple so a forged POST can't
  // write an off-list relation (same contract as updateTicketField's enum guard).
  if (!TICKET_LINK_TYPES.includes(type as (typeof TICKET_LINK_TYPES)[number])) return refused(INVALID_LINK);
  if (!(await ensureCanAct(id, me))) return refused(NOT_YOUR_TICKET);
  // Validate the target ticket exists before linking to it.
  const target = await db.ticket.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!target) return refused(TICKET_NOT_FOUND);
  // A pair is linked once, whichever side created it: the ticket page shows the
  // link on both ends, so a second row in the opposite direction would read as a
  // contradictory duplicate ("Blocks #B" and "Blocked by #B" on the same page).
  const inverse = await db.ticketLink.findUnique({
    where: { ticketId_linkedTicketId: { ticketId: targetId, linkedTicketId: id } },
    select: { id: true },
  });
  if (inverse) return refused(ALREADY_LINKED);
  await db.ticketLink.upsert({
    where: { ticketId_linkedTicketId: { ticketId: id, linkedTicketId: targetId } },
    create: { ticketId: id, linkedTicketId: targetId, type },
    update: { type },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: `Linked to ${ticketRef(targetId)}` });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: targetId, summary: `Linked from ${ticketRef(id)}` });
  revalidatePath(`/tickets/${id}`);
  revalidatePath(`/tickets/${targetId}`);
  return { ok: true };
}

export async function unlinkTicket(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return { ok: false, error: "Not authorised." };
  const linkId = String(formData.get("linkId"));
  if (!linkId) return { ok: false, error: "Missing link." };
  // Derive both ends from the link row itself — trusting a client-posted (or
  // absent) ticketId would skip authorization entirely. The link is shown on
  // both tickets, so being allowed to act on either end is enough to remove it.
  const link = await db.ticketLink.findUnique({ where: { id: linkId }, select: { ticketId: true, linkedTicketId: true } });
  if (!link) return { ok: false, error: "Link not found." };
  const mayAct = (await ensureCanAct(link.ticketId, me)) || (await ensureCanAct(link.linkedTicketId, me));
  if (!mayAct) return { ok: false, error: "You can't act on either linked ticket." };
  await db.ticketLink.delete({ where: { id: linkId } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: link.ticketId, summary: `Unlinked from ${ticketRef(link.linkedTicketId)}` });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: link.linkedTicketId, summary: `Unlinked from ${ticketRef(link.ticketId)}` });
  revalidatePath(`/tickets/${link.ticketId}`);
  revalidatePath(`/tickets/${link.linkedTicketId}`);
  return { ok: true };
}

// ── Parent / child tickets ───────────────────────────────────────────────────

const HIERARCHY_TICKET_SELECT = {
  id: true, type: true, prefix: true, assigneeId: true, groupId: true, parentId: true, status: true, mergedIntoId: true,
} as const;

type HierarchyTicket = {
  id: number; type: string; prefix: string | null; assigneeId: string | null; groupId: string | null;
  parentId: number | null; status: string; mergedIntoId: number | null;
};

/**
 * Make `parentId` the parent of `ticketId`; an empty `parentId` detaches the ticket.
 * Works from either side: the child's page picks a parent, the parent's page picks a child.
 */
export async function setTicketParent(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return refused(NOT_AUTHORISED);
  const ticketId = Number(formData.get("ticketId"));
  const raw = String(formData.get("parentId") ?? "").trim();
  const parentId = raw && raw !== "none" ? Number(raw) : null;
  if (!ticketId || Number.isNaN(parentId)) return refused(INVALID_LINK);

  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: HIERARCHY_TICKET_SELECT });
  if (!ticket) return refused(TICKET_NOT_FOUND);
  if (parentId === ticket.parentId) return { ok: true };
  return parentId === null ? detachFromParent(me, ticket) : attachToParent(me, ticket, parentId);
}

async function detachFromParent(me: Agent, ticket: HierarchyTicket): Promise<TicketActionResult> {
  const oldParent = await db.ticket.findUnique({ where: { id: ticket.parentId! }, select: HIERARCHY_TICKET_SELECT });
  // Either end may remove the link, like unlinkTicket.
  const mayAct = (await canActOnTicket(me, ticket)) || (!!oldParent && (await canActOnTicket(me, oldParent)));
  if (!mayAct) return refused(NOT_YOUR_TICKET);

  const notes = oldParent
    ? [
        { ticketId: ticket.id, text: `Removed from parent ${refOf(oldParent)}` },
        { ticketId: oldParent.id, text: `Detached child ${refOf(ticket)}` },
      ]
    : [];
  await db.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: ticket.id }, data: { parentId: null } });
    await writeParentNotes(tx, me, notes);
  });
  await auditParentNotes(me, notes);
  revalidatePath(`/tickets/${ticket.id}`);
  revalidatePath(`/tickets/${ticket.parentId}`);
  return { ok: true };
}

async function attachToParent(me: Agent, ticket: HierarchyTicket, parentId: number): Promise<TicketActionResult> {
  const parent = await db.ticket.findUnique({ where: { id: parentId }, select: HIERARCHY_TICKET_SELECT });
  if (!parent) return refused(TICKET_NOT_FOUND);
  // Both tickets get a note, so the actor must be allowed on both (same rule as mergeTicket).
  if (!(await canActOnTicket(me, ticket)) || !(await canActOnTicket(me, parent))) return refused(NOT_YOUR_TICKET);
  const previousParent = ticket.parentId === null
    ? null
    : await db.ticket.findUnique({ where: { id: ticket.parentId }, select: HIERARCHY_TICKET_SELECT });

  const notes = [
    { ticketId: ticket.id, text: `Set parent to ${refOf(parent)}${previousParent ? ` (was ${refOf(previousParent)})` : ""}` },
    { ticketId: parent.id, text: `Added child ${refOf(ticket)}` },
    ...(previousParent ? [{ ticketId: previousParent.id, text: `Child ${refOf(ticket)} moved to ${refOf(parent)}` }] : []),
  ];
  // The cycle and depth checks run in the same transaction as the write, so two
  // concurrent opposite links can't both pass them.
  const refusal = await db.$transaction(async (tx) => {
    const edges = await tx.ticket.findMany({ where: { parentId: { not: null } }, select: { id: true, parentId: true } });
    const found = parentLinkRefusal(ticket.id, parent, ancestorChain(parent.id, edges), subtreeHeight(ticket.id, edges));
    if (found) return found;
    await tx.ticket.update({ where: { id: ticket.id }, data: { parentId } });
    await writeParentNotes(tx, me, notes);
    return null;
  });
  if (refusal) return refused(refusal);

  await auditParentNotes(me, notes);
  revalidatePath(`/tickets/${ticket.id}`);
  revalidatePath(`/tickets/${parentId}`);
  if (previousParent) revalidatePath(`/tickets/${previousParent.id}`);
  return { ok: true };
}

type ParentNote = { ticketId: number; text: string };

/** An internal note on each affected ticket, written inside the link change's transaction. */
async function writeParentNotes(tx: Tx, me: Agent, notes: readonly ParentNote[]) {
  await tx.ticketComment.createMany({
    data: notes.map((n) => ({ ticketId: n.ticketId, authorId: me.id, isInternal: true, body: `${n.text}.` })),
  });
}

/** Audit entries go through `db`, so they are written after the transaction has committed. */
async function auditParentNotes(me: Agent, notes: readonly ParentNote[]) {
  for (const n of notes) {
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: n.ticketId, summary: n.text });
  }
}

/** The candidate parent followed by its ancestors, nearest first. Stops past the depth limit, so corrupt cyclic data can't loop. */
async function ancestorIds(parent: { id: number; parentId: number | null }): Promise<number[]> {
  const ids = [parent.id];
  let next = parent.parentId;
  while (next !== null && ids.length <= MAX_HIERARCHY_DEPTH) {
    ids.push(next);
    next = (await db.ticket.findUnique({ where: { id: next }, select: { parentId: true } }))?.parentId ?? null;
  }
  return ids;
}

// ── Merge / unmerge ──────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

const INVALID_MERGE = "Pick another ticket to merge into.";
/** A merge copies many rows one by one; SQLite needs more than Prisma's 5 s default. */
const MERGE_TRANSACTION_OPTIONS = { timeout: 30_000 };

const MERGE_TARGET_SELECT = {
  id: true, type: true, prefix: true, assigneeId: true, groupId: true, requesterId: true,
  parentId: true, mergedIntoId: true, status: true, problemId: true, changeId: true,
} as const;

const MERGE_SOURCE_INCLUDE = {
  comments: { orderBy: { createdAt: "asc" } },
  watchers: true,
  requester: { select: { name: true, email: true } },
} as const;

type MergeSourceTicket = Prisma.TicketGetPayload<{ include: typeof MERGE_SOURCE_INCLUDE }>;
type MergeTargetTicket = Prisma.TicketGetPayload<{ select: typeof MERGE_TARGET_SELECT }>;

/**
 * Cancel a ticket and carry its comments, watchers, assets, attachments, links,
 * problem/change and child tickets over to the target. Everything the merge adds is
 * recorded in a TicketMerge row so {@link unmergeTicket} can take exactly that back.
 */
export async function mergeTicket(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return refused(NOT_AUTHORISED);
  const id = Number(formData.get("id"));
  const targetId = Number(formData.get("targetId"));
  if (!id || !targetId || id === targetId) return refused(INVALID_MERGE);

  const source = await db.ticket.findUnique({ where: { id }, include: MERGE_SOURCE_INCLUDE });
  if (!source) return refused(TICKET_NOT_FOUND);
  // Only ADMIN/MANAGER, or the source's assignee / a member of its group, may merge it.
  if (!(await canActOnTicket(me, source))) return refused(NOT_YOUR_TICKET);

  const target = await db.ticket.findUnique({ where: { id: targetId }, select: MERGE_TARGET_SELECT });
  if (!target) return refused(TICKET_NOT_FOUND);
  // Merging writes into the TARGET too, so the actor must be allowed to act on it as well.
  if (!(await canActOnTicket(me, target))) return refused(NOT_YOUR_TICKET);
  const refusal = mergeRefusal(id, source, target, await ancestorIds(target));
  if (refusal) return refused(refusal);

  // One transaction, so a partial merge can't leave orphaned copies with the source still open.
  const stopped = await inRefusableTransaction((tx) => mergeInTransaction(tx, me, source, target));
  if (stopped) return refused(stopped);
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: `Merged into ${refOf(target)}` });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: targetId, summary: `Merged ${refOf(source)} into this ticket` });

  revalidatePath(`/tickets/${id}`);
  revalidatePath(`/tickets/${targetId}`);
  revalidatePath("/tickets");
  redirect(`/tickets/${targetId}`);
}

/** A refusal found inside a transaction: thrown so everything written so far is rolled back. */
class MergeRefused extends Error {}

/** Runs a merge/undo transaction; a {@link MergeRefused} rolls it back and comes out as the refusal text. */
async function inRefusableTransaction(run: (tx: Tx) => Promise<string | null>): Promise<string | null> {
  try {
    return await db.$transaction(run, MERGE_TRANSACTION_OPTIONS);
  } catch (error) {
    if (error instanceof MergeRefused) return error.message;
    throw error;
  }
}

/**
 * The merge itself. The checks that decide whether it may run are repeated here, on
 * the rows as they are now, so two concurrent merges can't both pass: the source is
 * claimed first (which also serialises the writers), then the target is re-read, and
 * the merge is rolled back when it can't go ahead.
 * Returns the refusal, or null once everything is written.
 */
async function mergeInTransaction(tx: Tx, me: Agent, source: MergeSourceTicket, target: MergeTargetTicket): Promise<string | null> {
  const approvalState = cancelledApprovalState(source);
  const claimed = await tx.ticket.updateMany({
    where: { id: source.id, mergedIntoId: null, status: source.status },
    data: { mergedIntoId: target.id, status: "CANCELLED", closedAt: new Date(), approvalState },
  });
  if (claimed.count === 0) return MERGE_REFUSALS.changedMeanwhile;
  await refuseUnlessTargetStillFits(tx, source.id, target.id);

  const foreignRequester = foreignRequesterLabel(source, target.requesterId);
  const copiedComments = await copyComments(tx, me, source, target.id, foreignRequester);

  const targetWatcherIds = (await tx.ticketWatcher.findMany({ where: { ticketId: target.id } })).map((w) => w.userId);
  const copiedWatcherIds = missingFrom(targetWatcherIds, source.watchers.map((w) => w.userId));
  await tx.ticketWatcher.createMany({ data: copiedWatcherIds.map((userId) => ({ ticketId: target.id, userId })) });

  const targetAssetIds = (await tx.ticketAsset.findMany({ where: { ticketId: target.id } })).map((a) => a.assetId);
  const sourceAssetIds = (await tx.ticketAsset.findMany({ where: { ticketId: source.id } })).map((a) => a.assetId);
  const copiedAssetIds = missingFrom(targetAssetIds, sourceAssetIds);
  await tx.ticketAsset.createMany({ data: copiedAssetIds.map((assetId) => ({ ticketId: target.id, assetId })) });

  const attachments = await moveAttachments(tx, me, source, target.id, copiedComments.bySourceId, foreignRequester !== null);
  const copiedLinkIds = await copyLinks(tx, source.id, target.id);

  const adoptedProblemId = adoptedId(target.problemId, source.problemId);
  const adoptedChangeId = adoptedId(target.changeId, source.changeId);
  if (adoptedProblemId !== null || adoptedChangeId !== null) {
    await tx.ticket.update({
      where: { id: target.id },
      data: { problemId: adoptedProblemId ?? undefined, changeId: adoptedChangeId ?? undefined },
    });
  }

  const movedChildIds = (await tx.ticket.findMany({ where: { parentId: source.id }, select: { id: true } })).map((c) => c.id);
  await tx.ticket.updateMany({ where: { id: { in: movedChildIds } }, data: { parentId: target.id } });

  const withdrawnApprovalIds = approvalState === "CANCELLED"
    ? (await tx.ticketApproval.findMany({ where: { ticketId: source.id, status: "PENDING" }, select: { id: true } })).map((a) => a.id)
    : [];
  await tx.ticketApproval.updateMany({
    where: { id: { in: withdrawnApprovalIds } },
    data: { status: "CANCELLED", decidedAt: new Date() },
  });

  await tx.ticketComment.create({
    data: {
      ticketId: source.id, authorId: me.id, isInternal: true,
      body: `Merged into ${refOf(target)}. Comments, watchers, assets, attachments, links and child tickets were carried over. The merge can be undone from this ticket.`,
    },
  });
  await tx.ticketMerge.create({
    data: {
      sourceId: source.id, targetId: target.id, mergedById: me.id,
      previousStatus: source.status, previousClosedAt: source.closedAt, previousApprovalState: source.approvalState,
      copiedCommentIds: JSON.stringify(attachments.noteId ? [...copiedComments.ids, attachments.noteId] : copiedComments.ids),
      copiedWatcherIds: JSON.stringify(copiedWatcherIds),
      copiedAssetIds: JSON.stringify(copiedAssetIds),
      movedAttachments: JSON.stringify(attachments.moved),
      copiedLinkIds: JSON.stringify(copiedLinkIds),
      movedChildIds: JSON.stringify(movedChildIds),
      withdrawnApprovalIds: JSON.stringify(withdrawnApprovalIds),
      adoptedProblemId, adoptedChangeId,
    },
  });
  return null;
}

/**
 * The target as it is now (not as the action read it before the transaction): a merge
 * the other way round, or one into a ticket cancelled meanwhile, must not go ahead.
 * Throws {@link MergeRefused} so the claim on the source is rolled back too.
 */
async function refuseUnlessTargetStillFits(tx: Tx, sourceId: number, targetId: number): Promise<void> {
  const target = await tx.ticket.findUniqueOrThrow({ where: { id: targetId }, select: { mergedIntoId: true, status: true } });
  const edges = await tx.ticket.findMany({ where: { parentId: { not: null } }, select: { id: true, parentId: true } });
  const targetChain = ancestorChain(targetId, edges);
  const refusal = mergeTargetRefusal(sourceId, target, targetChain) ?? mergeDepthRefusal(targetChain.length, subtreeHeight(sourceId, edges));
  if (refusal) throw new MergeRefused(refusal);
}

/**
 * The source's description and comments as copies on the target, attributed to their original
 * authors: internal notes, and all internal when the target belongs to another requester.
 */
async function copyComments(tx: Tx, me: Agent, source: MergeSourceTicket, targetId: number, foreignRequester: string | null) {
  const sourceRef = refOf(source);
  const intro = await tx.ticketComment.create({
    data: {
      ticketId: targetId, authorId: me.id, isInternal: true,
      body: `⤵︎ Merged from ${sourceRef} — "${source.title}"\n\n${source.description || "(no description)"}`,
    },
  });
  const ids = [intro.id];
  const bySourceId = new Map<string, string>();
  for (const c of source.comments) {
    const copy = await tx.ticketComment.create({
      data: { ticketId: targetId, authorId: c.authorId, createdAt: c.createdAt, ...planCommentCopy(c, sourceRef, foreignRequester) },
    });
    ids.push(copy.id);
    bySourceId.set(c.id, copy.id);
  }
  return { ids, bySourceId };
}

/**
 * Re-point the source's files to the target: ticket-level files to the target ticket,
 * comment files to the copy of their comment. Re-pointed rather than copied because
 * deleting an attachment also deletes its blob, which a copy would share.
 * With `internalOnly` (another requester owns the target) the ticket-level files go on one
 * internal note instead, so only agents see them; the note's id comes back to be recorded.
 */
async function moveAttachments(
  tx: Tx,
  me: Agent,
  source: MergeSourceTicket,
  targetId: number,
  copiedCommentIds: ReadonlyMap<string, string>,
  internalOnly: boolean,
): Promise<{ moved: MovedAttachment[]; noteId: string | null }> {
  const files = await tx.attachment.findMany({
    where: { OR: [{ ticketId: source.id }, { commentId: { in: [...copiedCommentIds.keys()] } }] },
    select: { id: true, commentId: true },
  });
  const copyOf = (file: MovedAttachment) => (file.commentId ? copiedCommentIds.get(file.commentId) : undefined);
  const hasTicketLevelFiles = files.some((file) => !copyOf(file));
  const note = internalOnly && hasTicketLevelFiles
    ? await tx.ticketComment.create({
        data: { ticketId: targetId, authorId: me.id, isInternal: true, body: `Attachments from merged ${refOf(source)}` },
      })
    : null;
  for (const file of files) {
    const copiedCommentId = copyOf(file);
    const destination = copiedCommentId
      ? { commentId: copiedCommentId }
      : note ? { ticketId: null, commentId: note.id } : { ticketId: targetId };
    await tx.attachment.update({ where: { id: file.id }, data: destination });
  }
  return { moved: files, noteId: note?.id ?? null };
}

/** Re-create the source's links on the target (and cross-link the two); returns the new link ids. */
async function copyLinks(tx: Tx, sourceId: number, targetId: number): Promise<string[]> {
  const touching = (ticketId: number) => ({ where: { OR: [{ ticketId }, { linkedTicketId: ticketId }] } });
  const sourceLinks = await tx.ticketLink.findMany(touching(sourceId));
  const targetLinks = await tx.ticketLink.findMany(touching(targetId));
  const ids: string[] = [];
  for (const link of planMergeLinks(sourceId, targetId, sourceLinks, targetLinks)) {
    ids.push((await tx.ticketLink.create({ data: link })).id);
  }
  return ids;
}

type UnmergeTicket = {
  id: number; type: string; prefix: string | null; assigneeId: string | null; groupId: string | null; mergedIntoId: number | null;
  sla: { businessCalendarId: string | null } | null;
};

/**
 * Undo the active merge of a ticket: reopen it as it was and take back exactly
 * what the merge added to the target (by the ids the merge recorded).
 */
export async function unmergeTicket(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return refused(NOT_AUTHORISED);
  const sourceId = Number(formData.get("id"));
  if (!sourceId) return refused(INVALID_CHANGE);

  const select = {
    id: true, type: true, prefix: true, assigneeId: true, groupId: true, mergedIntoId: true,
    sla: { select: { businessCalendarId: true } },
  } as const;
  const source: UnmergeTicket | null = await db.ticket.findUnique({ where: { id: sourceId }, select });
  if (!source) return refused(TICKET_NOT_FOUND);
  if (!(await canActOnTicket(me, source))) return refused(NOT_YOUR_TICKET);

  const merge = await db.ticketMerge.findFirst({ where: { sourceId, undoneAt: null }, orderBy: { createdAt: "desc" } });
  const target: UnmergeTicket | null = merge ? await db.ticket.findUnique({ where: { id: merge.targetId }, select }) : null;
  const refusal = unmergeRefusal({
    activeMerge: merge,
    sourceMergedIntoId: source.mergedIntoId,
    targetMergedIntoId: target?.mergedIntoId ?? null,
  });
  if (refusal) return refused(refusal);
  if (!merge || !target) return refused(TICKET_NOT_FOUND);
  // The undo writes into the target as well.
  if (!(await canActOnTicket(me, target))) return refused(NOT_YOUR_TICKET);

  // Loaded here: the calendar lookup uses `db`, which must not run inside the transaction.
  const calendar = await ticketCalendar(source);
  const stopped = await inRefusableTransaction((tx) => unmergeInTransaction(tx, me, source, target, merge, calendar));
  if (stopped) return refused(stopped);
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: sourceId, summary: `Undid the merge into ${refOf(target)}` });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: target.id, summary: `Undid the merge of ${refOf(source)}` });

  revalidatePath(`/tickets/${sourceId}`);
  revalidatePath(`/tickets/${target.id}`);
  revalidatePath("/tickets");
  return { ok: true };
}

async function unmergeInTransaction(
  tx: Tx,
  me: Agent,
  source: UnmergeTicket,
  target: UnmergeTicket,
  merge: TicketMerge,
  calendar: Awaited<ReturnType<typeof ticketCalendar>>,
): Promise<string | null> {
  // Claim the merge first: a second undo (double submit, another tab) finds it taken and stops.
  const claimed = await tx.ticketMerge.updateMany({
    where: { id: merge.id, undoneAt: null },
    data: { undoneAt: new Date(), undoneById: me.id },
  });
  if (claimed.count === 0) return MERGE_REFUSALS.alreadyUndone;

  // Claiming also serialises the writers: judge source and target as they are now, not as the action read them.
  const sourceNow = await tx.ticket.findUniqueOrThrow({
    where: { id: source.id },
    select: { mergedIntoId: true, responseDueAt: true, resolveDueAt: true, dueAt: true, pendingSince: true, pausedMs: true },
  });
  const targetNow = await tx.ticket.findUniqueOrThrow({ where: { id: target.id }, select: { mergedIntoId: true } });
  const refusal = unmergeRefusal({
    activeMerge: merge,
    sourceMergedIntoId: sourceNow.mergedIntoId,
    targetMergedIntoId: targetNow.mergedIntoId,
  });
  if (refusal) throw new MergeRefused(refusal);

  // Files first: deleting a copied comment would cascade-delete the files hanging on it.
  const moved = parseMovedAttachments(merge.movedAttachments);
  const sourceCommentIds = moved.flatMap((m) => (m.commentId ? [m.commentId] : []));
  const existingComments = await tx.ticketComment.findMany({ where: { id: { in: sourceCommentIds } }, select: { id: true } });
  for (const { id, ticketId, commentId } of planAttachmentRestore(moved, new Set(existingComments.map((c) => c.id)), source.id)) {
    await tx.attachment.updateMany({ where: { id }, data: { ticketId, commentId } });
  }
  // Files uploaded to a copied comment after the merge belong to the target now: they stay with its ticket.
  const copiedCommentIds = parseStringIds(merge.copiedCommentIds);
  await tx.attachment.updateMany({
    where: { commentId: { in: copiedCommentIds }, id: { notIn: moved.map((m) => m.id) } },
    data: { ticketId: target.id, commentId: null },
  });

  await tx.ticketComment.deleteMany({ where: { id: { in: copiedCommentIds }, ticketId: target.id } });
  await tx.ticketWatcher.deleteMany({ where: { ticketId: target.id, userId: { in: parseStringIds(merge.copiedWatcherIds) } } });
  await tx.ticketAsset.deleteMany({ where: { ticketId: target.id, assetId: { in: parseStringIds(merge.copiedAssetIds) } } });
  await tx.ticketLink.deleteMany({ where: { id: { in: parseStringIds(merge.copiedLinkIds) } } });

  // Only what is still as the merge left it: a problem/change or parent the agents changed since stays.
  if (merge.adoptedProblemId !== null) {
    await tx.ticket.updateMany({ where: { id: target.id, problemId: merge.adoptedProblemId }, data: { problemId: null } });
  }
  if (merge.adoptedChangeId !== null) {
    await tx.ticket.updateMany({ where: { id: target.id, changeId: merge.adoptedChangeId }, data: { changeId: null } });
  }
  const keptChildren = await restoreChildren(tx, source.id, target.id, parseNumberIds(merge.movedChildIds));

  await tx.ticketApproval.updateMany({
    where: { id: { in: parseStringIds(merge.withdrawnApprovalIds) }, status: "CANCELLED" },
    data: { status: "PENDING", decidedAt: null },
  });
  const restored = await tx.ticket.updateMany({
    where: { id: source.id, mergedIntoId: merge.targetId },
    data: {
      mergedIntoId: null,
      status: merge.previousStatus,
      closedAt: merge.previousClosedAt,
      approvalState: merge.previousApprovalState,
      ...undoClockData(sourceNow, merge.previousStatus, merge.createdAt, new Date(), calendar),
    },
  });
  if (restored.count === 0) throw new MergeRefused(MERGE_REFUSALS.changedMeanwhile);
  const keptNote = keptChildren.length > 0
    ? ` Child tickets that stayed under ${refOf(target)} because moving them back would create a hierarchy cycle: ${keptChildren.map((id) => `#${id}`).join(", ")}.`
    : "";
  await tx.ticketComment.createMany({
    data: [
      { ticketId: source.id, authorId: me.id, isInternal: true, body: `Merge into ${refOf(target)} undone. This ticket is back to ${merge.previousStatus.toLowerCase().replace(/_/g, " ")}.${keptNote}` },
      { ticketId: target.id, authorId: me.id, isInternal: true, body: `Merge of ${refOf(source)} undone. What the merge carried over was removed again.${keptNote}` },
    ],
  });
  return null;
}

/**
 * Put the children the merge moved back under the source, except those that are now
 * the source's own ancestors (see planChildRestore). Returns the kept ones that are
 * still below the target, so the notes can name them.
 */
async function restoreChildren(tx: Tx, sourceId: number, targetId: number, movedChildIds: readonly number[]): Promise<number[]> {
  const edges = await tx.ticket.findMany({ where: { parentId: { not: null } }, select: { id: true, parentId: true } });
  const { restore, kept } = planChildRestore(movedChildIds, ancestorChain(sourceId, edges));
  await tx.ticket.updateMany({ where: { id: { in: restore }, parentId: targetId }, data: { parentId: sourceId } });
  const stillBelowTarget = await tx.ticket.findMany({ where: { id: { in: kept }, parentId: targetId }, select: { id: true } });
  return stillBelowTarget.map((c) => c.id);
}

// ── Resolution / cancel ──────────────────────────────────────────────────────

type Agent = NonNullable<Awaited<ReturnType<typeof requireAgent>>>;

type ResolutionInput = {
  id: number;
  status: string;
  code: string | null;
  note: string | null;
  bodyHtml: string | null;
  noteInternal: boolean;
};

/**
 * Resolve, close or cancel a ticket. With `resolveChildren` on, a RESOLVED parent
 * takes its open child tickets along (same code and note) and reports how many.
 */
export async function setTicketResolution(
  formData: FormData,
): Promise<TicketActionResult & { childrenResolved?: number; refusedChildren?: RefusedChild[] }> {
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

  const input = { id, status, code, note, bodyHtml, noteInternal };
  const result = await applyResolution(me, input);
  if (!result.ok || status !== "RESOLVED" || formData.get("resolveChildren") !== "on") return result;
  return { ...result, ...(await resolveOpenChildren(me, input)) };
}

/** Resolve the open children of `parent` with the parent's resolution, one by one through {@link applyResolution}. */
async function resolveOpenChildren(me: Agent, parent: ResolutionInput) {
  const [parentTicket, children] = await Promise.all([
    db.ticket.findUnique({ where: { id: parent.id }, select: { id: true, type: true, prefix: true } }),
    db.ticket.findMany({ where: { parentId: parent.id }, select: { id: true, type: true, prefix: true, status: true }, orderBy: { id: "asc" } }),
  ]);
  const parentRef = parentTicket ? refOf(parentTicket) : ticketRef(parent.id);
  let childrenResolved = 0;
  const refusedChildren: RefusedChild[] = [];
  for (const child of openChildren(children)) {
    const result = await applyResolution(me, { ...parent, id: child.id });
    if (!result.ok) {
      refusedChildren.push({ ref: refOf(child), error: result.error ?? INVALID_CHANGE });
      continue;
    }
    await db.ticketComment.create({
      data: { ticketId: child.id, authorId: me.id, isInternal: true, body: `Resolved together with parent ${parentRef}.` },
    });
    childrenResolved++;
  }
  return { childrenResolved, refusedChildren };
}

async function applyResolution(
  me: Agent,
  { id, status, code, note, bodyHtml, noteInternal }: ResolutionInput,
): Promise<TicketActionResult> {
  const current = await db.ticket.findUnique({
    where: { id },
    include: { sla: { select: { businessCalendarId: true } } },
  });
  if (!current) return refused(TICKET_NOT_FOUND);
  if (!(await canActOnTicket(me, current))) return refused(NOT_YOUR_TICKET);
  const mergedRefusal = mergedStatusRefusal(current, status);
  if (mergedRefusal) return refused(mergedRefusal);
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

export async function unlinkAsset(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return refused(NOT_AUTHORISED);
  const ticketId = Number(formData.get("ticketId"));
  const assetId = String(formData.get("assetId") ?? "");
  if (!ticketId || !assetId) return refused(INVALID_LINK);
  if (!(await ensureCanAct(ticketId, me))) return refused(NOT_YOUR_TICKET);
  // Existence pre-check: an already-removed row is a benign no-op (not a P2025
  // 500), while a real DB failure now propagates instead of lying about success.
  const row = await db.ticketAsset.findUnique({ where: { ticketId_assetId: { ticketId, assetId } }, select: { ticketId: true } });
  if (!row) return { ok: true };
  await db.ticketAsset.delete({ where: { ticketId_assetId: { ticketId: row.ticketId, assetId } } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: ticketId, summary: "Unlinked an asset" });
  revalidatePath(`/tickets/${row.ticketId}`);
  revalidatePath(`/assets/${assetId}`);
  return { ok: true };
}

export async function unlinkRelation(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return refused(NOT_AUTHORISED);
  const ticketId = Number(formData.get("ticketId"));
  const kind = String(formData.get("kind") ?? "");
  if (!ticketId || !["problem", "change"].includes(kind)) return refused(INVALID_LINK);
  if (!(await ensureCanAct(ticketId, me))) return refused(NOT_YOUR_TICKET);
  await db.ticket.update({ where: { id: ticketId }, data: kind === "problem" ? { problemId: null } : { changeId: null } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: ticketId, summary: `Unlinked from ${kind}` });
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/problems");
  revalidatePath("/changes");
  return { ok: true };
}

/**
 * Attach (or, with an empty value, detach) a ticket to a Problem. Works from
 * either side: the ticket detail page passes its own ticketId + a chosen problemId;
 * the problem detail page passes its own problemId + a chosen ticketId.
 */
export async function setTicketProblem(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return refused(NOT_AUTHORISED);
  const ticketId = Number(formData.get("ticketId"));
  const raw = String(formData.get("problemId") ?? "").trim();
  const problemId = raw && raw !== "none" ? Number(raw) : null;
  if (!ticketId || Number.isNaN(problemId)) return refused(INVALID_LINK);
  if (!(await ensureCanAct(ticketId, me))) return refused(NOT_YOUR_TICKET);
  // Validate the target problem exists before linking.
  if (problemId && !(await db.problem.findUnique({ where: { id: problemId }, select: { id: true } }))) return refused("Problem not found.");
  await db.ticket.update({ where: { id: ticketId }, data: { problemId } });
  await writeAudit({
    userId: me.id, action: "UPDATE", entity: "Ticket", entityId: ticketId,
    summary: problemId ? `Linked to ${problemRef(problemId)}` : "Unlinked from problem",
  });
  revalidatePath(`/tickets/${ticketId}`);
  if (problemId) revalidatePath(`/problems/${problemId}`);
  revalidatePath("/problems");
  return { ok: true };
}

/** Attach/detach a ticket to a Change. Symmetric to setTicketProblem. */
export async function setTicketChange(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return refused(NOT_AUTHORISED);
  const ticketId = Number(formData.get("ticketId"));
  const raw = String(formData.get("changeId") ?? "").trim();
  const changeId = raw && raw !== "none" ? Number(raw) : null;
  if (!ticketId || Number.isNaN(changeId)) return refused(INVALID_LINK);
  if (!(await ensureCanAct(ticketId, me))) return refused(NOT_YOUR_TICKET);
  // Validate the target change exists before linking.
  if (changeId && !(await db.change.findUnique({ where: { id: changeId }, select: { id: true } }))) return refused("Change not found.");
  await db.ticket.update({ where: { id: ticketId }, data: { changeId } });
  await writeAudit({
    userId: me.id, action: "UPDATE", entity: "Ticket", entityId: ticketId,
    summary: changeId ? `Linked to ${changeRef(changeId)}` : "Unlinked from change",
  });
  revalidatePath(`/tickets/${ticketId}`);
  if (changeId) revalidatePath(`/changes/${changeId}`);
  revalidatePath("/changes");
  return { ok: true };
}

/** Link an asset (CMDB configuration item) to a ticket. */
export async function linkAsset(formData: FormData): Promise<TicketActionResult> {
  const me = await requireAgent();
  if (!me) return refused(NOT_AUTHORISED);
  const ticketId = Number(formData.get("ticketId"));
  const assetId = String(formData.get("assetId") ?? "").trim();
  if (!ticketId || !assetId) return refused(INVALID_LINK);
  if (!(await ensureCanAct(ticketId, me))) return refused(NOT_YOUR_TICKET);
  // Validate the target asset exists before linking.
  if (!(await db.asset.findUnique({ where: { id: assetId }, select: { id: true } }))) return refused("Asset not found.");
  await db.ticketAsset.upsert({
    where: { ticketId_assetId: { ticketId, assetId } },
    create: { ticketId, assetId },
    update: {},
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: ticketId, summary: "Linked an asset" });
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath(`/assets/${assetId}`);
  return { ok: true };
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
    await sendMail({ to: target.email, toName: target.name, entity: "Ticket", entityId: ticketId, ticketId, ...threadHeaders, ...(await tplTicketParticipant(ticket, target.name ?? "there", me.name, note, await mailBrand(target))) });
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
    select: { id: true, type: true, prefix: true, title: true, assigneeId: true, groupId: true, requesterId: true, requester: { select: { email: true } } },
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

  const ref = ticketRef(ticket.id, ticket.prefix || ticket.type);
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
  const threadHeaders = await forwardThreadHeaders(ticketId);
  // The external party needs the customer's evidence (screenshots, logs): files on
  // the forwarded public messages, plus ticket-level files the requester or a
  // customer-side participant uploaded (e.g. the opening email's attachments).
  // Agent uploads on the ticket itself may be internal or staged — never sent.
  const customerSide = [
    ticket.requesterId,
    ...(await db.ticketParticipant.findMany({ where: { ticketId }, select: { userId: true } })).map((p) => p.userId),
  ];
  const files = await db.attachment.findMany({
    where: { OR: [{ commentId: { in: chain.map((m) => m.id) } }, { ticketId, uploadedById: { in: customerSide } }] },
    select: { filename: true, storageKey: true },
  });
  await sendMail({
    to,
    cc,
    entity: "Ticket",
    entityId: ticketId,
    ticketId,
    ...threadHeaders,
    attachments: files.flatMap((f) => (f.storageKey ? [{ filename: f.filename, storageKey: f.storageKey }] : [])),
    template: FORWARD_TEMPLATE,
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

  const current = await db.ticket.findUnique({ where: { id }, select: { status: true, approvalState: true, pendingSince: true, assigneeId: true, groupId: true, mergedIntoId: true } });
  if (!current) return refused(TICKET_NOT_FOUND);
  if (!(await canActOnTicket(me, current))) return refused(NOT_YOUR_TICKET);
  const mergedRefusal = mergedStatusRefusal(current, status);
  if (mergedRefusal) return refused(mergedRefusal);
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
