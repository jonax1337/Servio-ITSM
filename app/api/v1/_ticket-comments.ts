import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import type { ApiPrincipal } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { canActOnTicket } from "@/lib/authz";
import { deliverTicketReply } from "@/lib/ticket-core";

/**
 * Writing to a ticket's thread through the API — shared by
 * POST /tickets/{id}/comments and the dedup comment of POST /tickets, so both
 * follow the console's addTicketComment rules.
 */

type Author = { id: string; email: string; name: string | null; role: string };
type Refusal = { status: 401 | 403 | 404; message: string };

/**
 * Whether the token's owner may write to this ticket's thread: only the assignee,
 * a member of the ticket's group or a MANAGER+ (an unassigned, ungrouped ticket is
 * the shared queue: any agent). Callers check that the principal is an agent.
 */
export async function authorizeTicketComment(
  principal: ApiPrincipal,
  ticket: { assigneeId: string | null; groupId: string | null },
): Promise<{ author: Author } | { refused: Refusal }> {
  const author = await db.user.findUnique({ where: { id: principal.userId }, select: { id: true, email: true, name: true, role: true } });
  if (!author) return { refused: { status: 401, message: "Missing or invalid API token." } };
  if (!(await canActOnTicket(author, ticket))) {
    return { refused: { status: 403, message: "Only the assignee, a member of the ticket's group or a manager may write to this ticket." } };
  }
  return { author };
}

/**
 * Add a reply or internal note as `author`: bumps the ticket's updatedAt, writes
 * the audit row, and — for a public reply — stamps the first response, notifies
 * watchers and mentions and emails the requester (deliverTicketReply, exactly
 * like a reply typed in the console).
 */
export async function writeTicketComment(author: Author, ticketId: number, text: string, internal: boolean) {
  const comment = await db.ticketComment.create({
    data: { ticketId, authorId: author.id, body: text, bodyHtml: null, isInternal: internal },
    include: { author: true },
  });
  const updated = await db.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() }, include: { requester: true } });
  await writeAudit({ userId: author.id, action: "UPDATE", entity: "Ticket", entityId: ticketId, summary: "Added a comment via API" });
  await deliverTicketReply({
    ticket: updated,
    comment,
    author: { ...author, name: author.name ?? author.email },
    body: text,
    bodyHtml: null,
    isInternal: internal,
  });
  revalidatePath(`/tickets/${ticketId}`);
  return comment;
}
