import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { guard, ok, apiError, preflight, paginate, pageMeta, principalIsAgent } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { canActOnTicket } from "@/lib/authz";
import { deliverTicketReply } from "@/lib/ticket-core";
import { commentCreateSchema } from "@/lib/api-itsm-input";
import { serializeComment } from "../../../_serializers";
import { readBody, recordId } from "../../../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

type Ctx = { params: Promise<{ id: string }> };

/** A ticket's thread. Agents see every comment; a USER token sees the public replies on its own tickets. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await guard(req, "read");
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
  const auth = await guard(req, "write");
  if ("response" in auth) return auth.response;
  const id = recordId((await ctx.params).id);
  const ticket = id ? await db.ticket.findUnique({ where: { id }, include: { requester: true } }) : null;
  if (!id || !ticket) return apiError(404, "Ticket not found");
  if (!principalIsAgent(auth.principal)) return apiError(404, "Ticket not found");

  const me = await db.user.findUnique({ where: { id: auth.principal.userId }, select: { id: true, email: true, name: true, role: true } });
  if (!me) return apiError(401, "Missing or invalid API token.");
  if (!(await canActOnTicket(me, { assigneeId: ticket.assigneeId, groupId: ticket.groupId }))) {
    return apiError(403, "Only the assignee, a member of the ticket's group or a manager may write to this ticket.");
  }
  const body = await readBody(req, commentCreateSchema);
  if ("response" in body) return body.response;
  const { body: text, internal } = body.data;

  const comment = await db.ticketComment.create({
    data: { ticketId: id, authorId: me.id, body: text, bodyHtml: null, isInternal: internal },
    include: { author: true },
  });
  const updated = await db.ticket.update({ where: { id }, data: { updatedAt: new Date() }, include: { requester: true } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: "Added a comment via API" });
  await deliverTicketReply({
    ticket: updated,
    comment,
    author: { ...me, name: me.name ?? me.email },
    body: text,
    bodyHtml: null,
    isInternal: internal,
  });
  revalidatePath(`/tickets/${id}`);
  return ok(serializeComment(comment), { status: 201 });
}
