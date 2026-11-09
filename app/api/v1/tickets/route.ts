import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { guard, ok, apiError, preflight, paginate, pageMeta, principalIsAgent, validateTicketAssignee, type ApiPrincipal } from "@/lib/api";
import { camelizeBody } from "@/lib/api-case";
import { writeAudit } from "@/lib/audit";
import { slaCreateData } from "@/lib/sla";
import { autoAssignTicket } from "@/lib/assignment";
import { duplicateCommentText, dueDateAuditSummary, ticketCreateSchema, type TicketCreate } from "@/lib/api-ticket-input";
import { isOpenExternalRefConflict } from "@/lib/ticket-external-ref";
import { TICKET_INCLUDE, serializeComment, serializeTicket } from "../_serializers";
import { authorizeTicketComment, writeTicketComment } from "../_ticket-comments";
import { openTicketByRef } from "../_ticket-ref";
import { OPEN_TICKET_STATUSES, prefixForType } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const auth = await guard(req, "tickets:read");
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const { page, perPage, skip, take } = paginate(url.searchParams);

  // Non-agent tokens are scoped to the caller's own tickets (no org-wide PII).
  const where: Prisma.TicketWhereInput = principalIsAgent(auth.principal)
    ? {}
    : { requesterId: auth.principal.userId };
  const status = url.searchParams.get("status");
  const priority = url.searchParams.get("priority");
  const type = url.searchParams.get("type");
  const q = url.searchParams.get("q");
  if (status === "open") where.status = { in: [...OPEN_TICKET_STATUSES] };
  else if (status) where.status = status;
  if (priority) where.priority = priority;
  if (type) where.type = type;
  if (q) where.title = { contains: q };
  const importRef = url.searchParams.get("import_ref");
  if (importRef) where.importRef = importRef;
  // Every ticket that ever carried this key (open and resolved); see /tickets/ref/{ref} for "the" one.
  const externalRef = url.searchParams.get("external_ref");
  if (externalRef) where.externalRef = externalRef;
  // Tickets ordered from the catalog item with this origin key (see /catalog-items/ref/{ref}); none when no item has it.
  const catalogItemRef = url.searchParams.get("catalog_item_ref");
  if (catalogItemRef) where.catalogItem = { is: { importRef: catalogItemRef } };

  const [total, tickets] = await Promise.all([
    db.ticket.count({ where }),
    db.ticket.findMany({
      where,
      include: TICKET_INCLUDE,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(tickets.map(serializeTicket), { meta: pageMeta(page, perPage, total) });
}

/** Attempts at "create, or find the winner" before a racing writer is given up on (each one lost a race). */
const DEDUP_ATTEMPTS = 3;

/** The validated create fields minus the dedup controls; `dueAt` is already the manual `dueDate`. */
type TicketFields = Omit<TicketCreate, "externalRef" | "onDuplicate" | "dueAt"> & { dueDate?: Date };

export async function POST(req: Request) {
  const auth = await guard(req, "tickets:write");
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body");
  }
  // snake_case keys are accepted too (lib/api-case.ts).
  const normalized = camelizeBody(body);
  if ("conflict" in normalized) return apiError(422, "Validation failed", { _: normalized.conflict.map((c) => `Conflicting values for ${c}`) });
  const parsed = ticketCreateSchema.safeParse(normalized.body);
  if (!parsed.success) return apiError(422, "Validation failed", parsed.error.flatten().fieldErrors);
  const { externalRef, onDuplicate, dueAt, ...rest } = parsed.data;
  // The manual due date lives in `dueDate`; `dueAt` is the SLA mirror column and must never receive it.
  const fields: TicketFields = { ...rest, ...(dueAt && { dueDate: new Date(dueAt) }) };

  const isAgentPrincipal = principalIsAgent(auth.principal);
  // The dedup key is for integrations (monitoring), which run on agent tokens; a
  // USER token must not be able to attach its tickets to — or probe — an alert.
  if (externalRef && !isAgentPrincipal) {
    return apiError(403, "external_ref needs a token owned by an agent (AGENT, MANAGER or ADMIN).");
  }
  // Like the console, only agents set a due date (a USER token's request must not be silently dropped).
  if (dueAt && !isAgentPrincipal) {
    return apiError(403, "due_at needs a token owned by an agent (AGENT, MANAGER or ADMIN).");
  }
  // FK existence up front — a bogus requester/category/service/group id is a 422,
  // not a 500 on the Prisma FK constraint (matches the assigneeId contract).
  if (fields.requesterId && !(await db.user.findUnique({ where: { id: fields.requesterId }, select: { id: true } }))) {
    return apiError(422, "Validation failed", { requesterId: [`Unknown requester: ${fields.requesterId}`] });
  }
  const category = fields.categoryId
    ? await db.category.findUnique({ where: { id: fields.categoryId }, select: { groupId: true } })
    : null;
  if (fields.categoryId && !category) {
    return apiError(422, "Validation failed", { categoryId: [`Unknown category: ${fields.categoryId}`] });
  }
  if (isAgentPrincipal && fields.groupId && !(await db.group.findUnique({ where: { id: fields.groupId }, select: { id: true } }))) {
    return apiError(422, "Validation failed", { groupId: [`Unknown group: ${fields.groupId}`] });
  }
  // The category's team routes a ticket that names no group.
  if (isAgentPrincipal) fields.groupId = fields.groupId ?? category?.groupId ?? undefined;
  // Only agents may set assigneeId; validate it up front so a bad id is a 422,
  // not a 500 on the FK, and never assigns a non-agent or an out-of-group user.
  if (isAgentPrincipal && fields.assigneeId) {
    const reason = await validateTicketAssignee(fields.assigneeId, fields.groupId ?? null);
    if (reason) return apiError(422, "Validation failed", { assigneeId: [reason] });
  }
  if (fields.serviceId && !(await db.service.findUnique({ where: { id: fields.serviceId }, select: { id: true } }))) {
    return apiError(422, "Validation failed", { serviceId: [`Unknown service: ${fields.serviceId}`] });
  }
  if (isAgentPrincipal && fields.status && !OPEN_TICKET_STATUSES.includes(fields.status as (typeof OPEN_TICKET_STATUSES)[number])) {
    return apiError(422, "Validation failed", { status: ["Tickets can only be created in an open status (NEW, OPEN, IN_PROGRESS, PENDING, ON_HOLD); transition after creation instead."] });
  }

  if (!externalRef) return createTicket(auth.principal, fields, isAgentPrincipal);

  // One OPEN ticket per external reference. The unique index on openExternalRef
  // is the arbiter: of concurrent creators exactly one insert wins, the others
  // hit P2002 and answer with the winner. Re-checked per attempt, because the
  // open ticket can be resolved between our lookup and our insert.
  for (let attempt = 0; attempt < DEDUP_ATTEMPTS; attempt++) {
    const open = await openTicketByRef(externalRef);
    if (open) return deduplicated(auth.principal, open.id, onDuplicate, fields);
    try {
      return await createTicket(auth.principal, fields, true, externalRef);
    } catch (err) {
      if (!isOpenExternalRefConflict(err)) throw err;
    }
  }
  return apiError(409, "Another request kept claiming this external_ref; retry.");
}

/** Insert the ticket (201). With `externalRef`, it also claims the key while open. */
async function createTicket(principal: ApiPrincipal, fields: TicketFields, isAgentPrincipal: boolean, externalRef?: string) {
  // Non-agents can only file tickets as themselves; agents may set requesterId.
  const requesterId = isAgentPrincipal ? fields.requesterId ?? principal.userId : principal.userId;
  // Resolve SLA + deadlines from the service/priority at creation time.
  const sla = await slaCreateData({ serviceId: fields.serviceId, priority: fields.priority });
  // Non-agents may not set server-controlled fields (status/assignee/queue/etc.)
  // — those fall back to schema defaults. Prevents self-assign / pre-resolved
  // tickets that would skew SLA and metrics. Agents may pick a starting status,
  // but it must be an OPEN one (checked by the caller): a ticket can't be born
  // RESOLVED/CLOSED (that would skip breach stamping, automations and the survey pipeline).
  const data = isAgentPrincipal
    ? {
        ...fields,
        prefix: prefixForType(fields.type),
        ...sla,
        requesterId,
        source: "API" as const,
        ...(externalRef && { externalRef, openExternalRef: externalRef }),
      }
    : {
        title: fields.title,
        description: fields.description,
        type: fields.type,
        prefix: prefixForType(fields.type),
        priority: fields.priority,
        impact: fields.impact,
        urgency: fields.urgency,
        ...sla,
        requesterId,
        source: "API" as const,
      };
  let ticket = await db.ticket.create({
    data,
    include: TICKET_INCLUDE,
  });
  await writeAudit({
    userId: principal.userId, action: "CREATE", entity: "Ticket", entityId: ticket.id,
    summary: externalRef ? `Created via API (${externalRef})` : "Created via API",
  });
  if (fields.dueDate) {
    await writeAudit({ userId: principal.userId, action: "UPDATE", entity: "Ticket", entityId: ticket.id, summary: dueDateAuditSummary(fields.dueDate) });
  }
  // Like a console-routed ticket: the group's auto-assign strategy picks an agent.
  if (ticket.groupId && !ticket.assigneeId && (await autoAssignTicket(ticket.id))) {
    ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: TICKET_INCLUDE });
  }

  return ok(serializeTicket(ticket), { status: 201, ...(externalRef && { meta: { deduplicated: false } }) });
}

/**
 * The answer to a repeated alert: the open ticket (200, `meta.deduplicated`).
 * With `on_duplicate: "comment"` the alert's description is added to it as an
 * internal note through the same path as POST /tickets/{id}/comments; when the
 * token's owner may not write to that ticket the answer is that endpoint's 403,
 * with the ticket in `details`.
 */
async function deduplicated(principal: ApiPrincipal, ticketId: number, onDuplicate: TicketCreate["onDuplicate"], fields: { title: string; description?: string }) {
  const include = TICKET_INCLUDE;
  if (onDuplicate !== "comment") {
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, include });
    return ok(serializeTicket(ticket), { meta: { deduplicated: true, comment: null } });
  }
  const target = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, select: { assigneeId: true, groupId: true } });
  const allowed = await authorizeTicketComment(principal, target);
  if ("refused" in allowed) {
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, include });
    return apiError(allowed.refused.status, allowed.refused.message, { deduplicated: true, ticket: serializeTicket(ticket) });
  }
  const comment = await writeTicketComment(allowed.author, ticketId, duplicateCommentText(fields), true);
  const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, include });
  return ok(serializeTicket(ticket), { meta: { deduplicated: true, comment: serializeComment(comment) } });
}
