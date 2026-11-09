import { db } from "@/lib/db";
import { guard, ok, apiError, preflight, paginate, pageMeta, principalIsAgent } from "@/lib/api";
import { commentCreateSchema } from "@/lib/api-itsm-input";
import { serializeComment } from "../../../_serializers";
import { readBody, recordId } from "../../../_itsm";
import { authorizeTicketComment, writeTicketComment } from "../../../_ticket-comments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

type Ctx = { params: Promise<{ id: string }> };

/** A ticket's thread. Agents see every comment; a USER token sees the public replies on its own tickets. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await guard(req, "tickets:read");
  if ("response" in auth) return auth.response;
  const id = recordId((await ctx.params).id);
  const ticket = id ? await db.ticket.findUnique({ where: { id }, select: { requesterId: true } }) : null;
  const isAgent = principalIsAgent(auth.principal);
  // 404, not 403, for someone else's ticket: don't leak that it exists.
  if (!id || !ticket || (!isAgent && ticket.requesterId !== auth.principal.userId)) return apiError(404, "Ticket not found");

  const where = { ticketId: id, ...(isAgent ? {} : { isInternal: false }) };
  const { page, perPage, skip, take } = paginate(new URL(req.url).searchParams);
  const [total, rows] = await Promise.all([
    db.ticketComment.count({ where }),
    db.ticketComment.findMany({ where, include: { author: true }, orderBy: { createdAt: "asc" }, skip, take }),
  ]);
  return ok(rows.map(serializeComment), { meta: pageMeta(page, perPage, total) });
}

/**
 * Add a reply or internal note, as the console's addTicketComment does: only the
 * assignee, a member of the ticket's group or a MANAGER+ may write to the
 * thread. A public reply (`internal: false`) stamps the first response, notifies
 * watchers and mentions, and emails the requester, exactly like a reply typed
 * in the console. `internal` defaults to true.
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await guard(req, "tickets:write");
  if ("response" in auth) return auth.response;
  const id = recordId((await ctx.params).id);
  const ticket = id ? await db.ticket.findUnique({ where: { id }, select: { assigneeId: true, groupId: true } }) : null;
  if (!id || !ticket) return apiError(404, "Ticket not found");
  if (!principalIsAgent(auth.principal)) return apiError(404, "Ticket not found");

  const allowed = await authorizeTicketComment(auth.principal, ticket);
  if ("refused" in allowed) return apiError(allowed.refused.status, allowed.refused.message);
  const body = await readBody(req, commentCreateSchema);
  if ("response" in body) return body.response;

  const comment = await writeTicketComment(allowed.author, id, body.data.body, body.data.internal);
  return ok(serializeComment(comment), { status: 201 });
}
