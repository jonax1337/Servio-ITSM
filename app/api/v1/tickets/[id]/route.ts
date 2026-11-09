import { z } from "zod";
import { db } from "@/lib/db";
import { guard, ok, apiError, preflight, principalIsAgent, validateTicketAssignee } from "@/lib/api";
import { camelizeBody } from "@/lib/api-case";
import { writeAudit } from "@/lib/audit";
import { autoAssignTicket, isGroupMember } from "@/lib/assignment";
import { slaRepricePatch, statusChangeData, ticketCalendar } from "@/lib/sla";
import { withdrawPendingApprovals } from "@/lib/approval-seating";
import { canTransitionConfigured } from "@/lib/workflow";
import { approvalAllowsStatus } from "@/lib/transitions";
import { mergedStatusRefusal } from "@/lib/merge-rules";
import { TICKET_INCLUDE, serializeTicket } from "../../_serializers";
import { dueAtSchema, dueDateAuditSummary } from "@/lib/api-ticket-input";
import { canActOnTicket } from "@/lib/authz";
import { setTicketChange, setTicketProblem } from "@/lib/actions/tickets";
import { formOf } from "@/lib/api-itsm-input";
import { asActor, refusal } from "../../_itsm";
import { TICKET_STATUSES, PRIORITIES } from "@/lib/constants";
import type { Role } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guard(req, "tickets:read");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const ticketId = Number(id);
  if (!Number.isInteger(ticketId)) return apiError(404, "Ticket not found");

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: TICKET_INCLUDE,
  });
  if (!ticket) return apiError(404, "Ticket not found");
  // Non-agents may only read their own tickets (404, not 403, to avoid leaking existence).
  if (!principalIsAgent(auth.principal) && ticket.requesterId !== auth.principal.userId)
    return apiError(404, "Ticket not found");
  return ok(serializeTicket(ticket));
}

const patchSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.string().nullable().optional(),
  // Re-routing to a group the current assignee is not in clears the assignee (as in the console).
  groupId: z.string().nullable().optional(),
  // The affected service; a change re-prices the SLA deadlines like the console does (null clears it).
  serviceId: z.string().min(1).nullable().optional(),
  // The manual due date (ISO 8601 with offset; null clears it). It never changes the SLA deadlines.
  dueAt: dueAtSchema.nullable().optional(),
  // Links, applied through the console's setTicketProblem / setTicketChange (null unlinks).
  problemId: z.number().int().positive().nullable().optional(),
  changeId: z.number().int().positive().nullable().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await guard(req, "tickets:write");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const ticketId = Number(id);
  if (!Number.isInteger(ticketId)) return apiError(404, "Ticket not found");

  const existing = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { sla: { select: { businessCalendarId: true } } },
  });
  if (!existing) return apiError(404, "Ticket not found");
  // Non-agents cannot mutate tickets via the API (they may only read their own).
  if (!principalIsAgent(auth.principal)) return apiError(404, "Ticket not found");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body");
  }
  // snake_case keys are accepted too (lib/api-case.ts).
  const normalized = camelizeBody(body);
  if ("conflict" in normalized) return apiError(422, "Validation failed", { _: normalized.conflict.map((c) => `Conflicting values for ${c}`) });
  const parsed = patchSchema.safeParse(normalized.body);
  if (!parsed.success) return apiError(422, "Validation failed", parsed.error.flatten().fieldErrors);

  const { groupId, serviceId } = parsed.data;
  if (groupId && !(await db.group.findUnique({ where: { id: groupId }, select: { id: true } }))) {
    return apiError(422, "Validation failed", { groupId: [`Unknown group: ${groupId}`] });
  }
  if (serviceId && !(await db.service.findUnique({ where: { id: serviceId }, select: { id: true } }))) {
    return apiError(422, "Validation failed", { serviceId: [`Unknown service: ${serviceId}`] });
  }
  // Validate a (re)assignment up front so a bad assigneeId is a 422, not a 500
  // on the FK, and so we never assign a non-agent or an out-of-group user.
  if (parsed.data.assigneeId) {
    const reason = await validateTicketAssignee(parsed.data.assigneeId, groupId === undefined ? existing.groupId : groupId);
    if (reason) return apiError(422, "Validation failed", { assigneeId: [reason] });
  }

  const { problemId, changeId, dueAt, ...fields } = parsed.data;
  const data = { ...fields } as Record<string, unknown>;
  // Manual due date: stored in `dueDate` (`dueAt` is the SLA mirror column). Same right as the console's picker.
  if (dueAt !== undefined) {
    if (!(await canActOnTicket({ id: auth.principal.userId, role: auth.principal.role }, existing))) {
      return apiError(403, "Only the assignee, a member of the ticket's group or a manager may change the due date.");
    }
    data.dueDate = dueAt === null ? null : new Date(dueAt);
  }
  const regrouped = groupId !== undefined && groupId !== existing.groupId;
  if (regrouped && groupId && parsed.data.assigneeId === undefined && existing.assigneeId && !(await isGroupMember(groupId, existing.assigneeId))) {
    data.assigneeId = null;
  }

  // SLA recompute: a priority or service change on an open ticket re-stamps the
  // deadlines (same contract as the console's updateTicketField). Done BEFORE the
  // status side effects so a pause resume shifts the new deadlines, not the old ones.
  const priorityChanged = !!parsed.data.priority && parsed.data.priority !== existing.priority;
  const serviceChanged = serviceId !== undefined && serviceId !== existing.serviceId;
  const reprice = priorityChanged || serviceChanged
    ? await slaRepricePatch(existing, {
        priority: parsed.data.priority ?? existing.priority,
        serviceId: serviceChanged ? serviceId : existing.serviceId,
        slaId: existing.slaId,
      })
    : {};
  Object.assign(data, reprice);

  const to = parsed.data.status;
  if (to && to !== existing.status) {
    if (!approvalAllowsStatus(existing.approvalState, to)) {
      return apiError(409, "This request is awaiting approval; it can only be cancelled until it is decided.");
    }
    const mergedRefusal = mergedStatusRefusal(existing, to);
    if (mergedRefusal) return apiError(409, mergedRefusal);
    // Mirror the server-action lifecycle: guard the ADMIN-CONFIGURED transition
    // map (built-ins + overrides + role gates) and run the shared SLA clock
    // helper, so an API token can't do transitions the console forbids.
    if (!(await canTransitionConfigured("TICKET", existing.status, to, auth.principal.role as Role))) {
      return apiError(409, `Illegal status transition ${existing.status} → ${to}`);
    }
    Object.assign(data, statusChangeData({ ...existing, ...reprice }, to, new Date(), await ticketCalendar(existing)));
  }

  let ticket = await db.ticket.update({
    where: { id: ticketId },
    data,
    include: TICKET_INCLUDE,
  });
  await withdrawPendingApprovals(ticketId, data);
  await writeAudit({ userId: auth.principal.userId, action: "UPDATE", entity: "Ticket", entityId: ticket.id, summary: "Updated via API" });
  if (dueAt !== undefined) {
    await writeAudit({ userId: auth.principal.userId, action: "UPDATE", entity: "Ticket", entityId: ticket.id, summary: dueDateAuditSummary(dueAt === null ? null : new Date(dueAt)) });
  }
  // As in the console, a re-routed ticket without an assignee gets one from the group's strategy.
  if (regrouped && groupId && (await autoAssignTicket(ticketId))) {
    ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: TICKET_INCLUDE });
  }

  // Same permission as the console: only someone who may act on the ticket links it.
  const linkError = await asActor(auth.principal, async () => {
    if (problemId !== undefined) {
      const r = await setTicketProblem(formOf({ ticketId, problemId }));
      if (!r.ok) return r.error ?? "The problem link was refused.";
    }
    if (changeId !== undefined) {
      const r = await setTicketChange(formOf({ ticketId, changeId }));
      if (!r.ok) return r.error ?? "The change link was refused.";
    }
    return null;
  });
  if (problemId !== undefined || changeId !== undefined) {
    ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: TICKET_INCLUDE });
  }
  if (linkError) return refusal(linkError, { ticket: serializeTicket(ticket) });

  return ok(serializeTicket(ticket));
}
