import { db } from "@/lib/db";
import { holdsExternalRef } from "@/lib/ticket-external-ref";
import { TICKET_INCLUDE } from "./_serializers";

/**
 * Tickets by external reference (monitoring dedup, see lib/ticket-external-ref.ts).
 * `requesterId` scopes the lookup to one requester's tickets (non-agent tokens);
 * null looks at every ticket.
 */


/**
 * The OPEN ticket carrying `ref`, or null. A claim still held by a ticket that is
 * no longer open (only possible through a write that bypassed the Prisma client,
 * e.g. hand-run SQL) is released on the way, so it can never block a new ticket.
 */
export async function openTicketByRef(ref: string, requesterId: string | null = null) {
  const holder = await db.ticket.findUnique({ where: { openExternalRef: ref }, include: TICKET_INCLUDE });
  if (!holder) return null;
  if (!holdsExternalRef(holder.status)) {
    await db.ticket.updateMany({ where: { id: holder.id, openExternalRef: ref }, data: { openExternalRef: null } });
    return null;
  }
  if (requesterId && holder.requesterId !== requesterId) return null;
  return holder;
}

/** The open ticket carrying `ref`, else the most recent one that ever carried it, or null. */
export async function ticketByRef(ref: string, requesterId: string | null = null) {
  return (
    (await openTicketByRef(ref, requesterId)) ??
    (await db.ticket.findFirst({
      where: { externalRef: ref, ...(requesterId && { requesterId }) },
      include: TICKET_INCLUDE,
      orderBy: { id: "desc" },
    }))
  );
}
