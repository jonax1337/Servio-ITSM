import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard, ok, apiError, preflight, paginate, pageMeta, principalIsAgent, validateTicketAssignee } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { slaCreateData } from "@/lib/sla";
import { serializeTicket } from "../_serializers";
import {
  TICKET_TYPES, TICKET_STATUSES, PRIORITIES, IMPACT_URGENCY, OPEN_TICKET_STATUSES,
  prefixForType,
} from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const auth = await guard(req, "read");
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

  const [total, tickets] = await Promise.all([
    db.ticket.count({ where }),
    db.ticket.findMany({
      where,
      include: { requester: true, assignee: true },
      orderBy: { updatedAt: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(tickets.map(serializeTicket), { meta: pageMeta(page, perPage, total) });
}

const createSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional().default(""),
  type: z.enum(TICKET_TYPES).optional().default("INCIDENT"),
  priority: z.enum(PRIORITIES).optional().default("MEDIUM"),
  impact: z.enum(IMPACT_URGENCY).optional().default("MEDIUM"),
  urgency: z.enum(IMPACT_URGENCY).optional().default("MEDIUM"),
  status: z.enum(TICKET_STATUSES).optional().default("NEW"),
  requesterId: z.string().optional(),
  assigneeId: z.string().optional(),
  categoryId: z.string().optional(),
  serviceId: z.string().optional(),
});

export async function POST(req: Request) {
  const auth = await guard(req, "write");
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Invalid JSON body");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return apiError(422, "Validation failed", parsed.error.flatten().fieldErrors);

  const isAgentPrincipal = principalIsAgent(auth.principal);
  // Only agents may set assigneeId; validate it up front so a bad id is a 422,
  // not a 500 on the FK, and never assigns a non-agent (no group on create).
  if (isAgentPrincipal && parsed.data.assigneeId) {
    const reason = await validateTicketAssignee(parsed.data.assigneeId, null);
    if (reason) return apiError(422, "Validation failed", { assigneeId: [reason] });
  }
  // FK existence up front — a bogus requester/category/service id is a 422, not
  // a 500 on the Prisma FK constraint (matches the assigneeId contract).
  if (parsed.data.requesterId && !(await db.user.findUnique({ where: { id: parsed.data.requesterId }, select: { id: true } }))) {
    return apiError(422, "Validation failed", { requesterId: [`Unknown requester: ${parsed.data.requesterId}`] });
  }
  if (parsed.data.categoryId && !(await db.category.findUnique({ where: { id: parsed.data.categoryId }, select: { id: true } }))) {
    return apiError(422, "Validation failed", { categoryId: [`Unknown category: ${parsed.data.categoryId}`] });
  }
  if (parsed.data.serviceId && !(await db.service.findUnique({ where: { id: parsed.data.serviceId }, select: { id: true } }))) {
    return apiError(422, "Validation failed", { serviceId: [`Unknown service: ${parsed.data.serviceId}`] });
  }
  // Non-agents can only file tickets as themselves; agents may set requesterId.
  const requesterId = isAgentPrincipal
    ? parsed.data.requesterId ?? auth.principal.userId
    : auth.principal.userId;
  // Resolve SLA + deadlines from the service/priority at creation time.
  const sla = await slaCreateData({ serviceId: parsed.data.serviceId, priority: parsed.data.priority });
  // Non-agents may not set server-controlled fields (status/assignee/queue/etc.)
  // — those fall back to schema defaults. Prevents self-assign / pre-resolved
  // tickets that would skew SLA and metrics. Agents may pick a starting status,
  // but it must be an OPEN one: a ticket can't be born RESOLVED/CLOSED (that
  // would skip breach stamping, automations and the survey pipeline).
  const agentData = { ...parsed.data, prefix: prefixForType(parsed.data.type), ...sla, requesterId, source: "API" as const };
  if (isAgentPrincipal && parsed.data.status && !OPEN_TICKET_STATUSES.includes(parsed.data.status as (typeof OPEN_TICKET_STATUSES)[number])) {
    return apiError(422, "Validation failed", { status: ["Tickets can only be created in an open status (NEW, OPEN, IN_PROGRESS, PENDING, ON_HOLD); transition after creation instead."] });
  }
  const data = isAgentPrincipal
    ? agentData
    : {
        title: parsed.data.title,
        description: parsed.data.description,
        type: parsed.data.type,
        prefix: prefixForType(parsed.data.type),
        priority: parsed.data.priority,
        impact: parsed.data.impact,
        urgency: parsed.data.urgency,
        ...sla,
        requesterId,
        source: "API" as const,
      };
  const ticket = await db.ticket.create({
    data,
    include: { requester: true, assignee: true },
  });
  await writeAudit({ userId: auth.principal.userId, action: "CREATE", entity: "Ticket", entityId: ticket.id, summary: "Created via API" });

  return ok(serializeTicket(ticket), { status: 201 });
}
