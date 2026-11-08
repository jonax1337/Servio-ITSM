import "server-only";

import { db } from "@/lib/db";
import { getTicketClosedEmailEnabled } from "@/lib/settings";
import { mailBrand, sendMail, ticketThreadHeaders } from "@/lib/mail";
import { renderTicketClosedEmail } from "@/lib/email-templates";
import { ticketCcEmails } from "@/lib/ticket-core";
import { ticketRef } from "@/lib/constants";

/**
 * The "ticket_closed" email to the requester (participants in CC, on the ticket's
 * mail thread, in the requester's language). Sent only while Settings › Tickets ›
 * "Email the requester when a ticket is closed" is on (TICKET_CLOSED_EMAIL_ENABLED,
 * default off). Called after a ticket moved to CLOSED: by an agent
 * (lib/actions/tickets.ts) or by the auto-close tick. `actorEmail` is left out of CC.
 */
export async function sendTicketClosedMail(ticketId: number, actorEmail?: string | null): Promise<void> {
  if (!(await getTicketClosedEmailEnabled())) return;
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, title: true, type: true, prefix: true, requester: { select: { email: true, name: true, locale: true } } },
  });
  const requester = ticket?.requester;
  if (!ticket || !requester?.email) return;
  await sendMail({
    to: requester.email, toName: requester.name,
    cc: await ticketCcEmails(ticket.id, [requester.email, actorEmail]),
    entity: "Ticket", entityId: ticket.id, ticketId: ticket.id,
    ...(await ticketThreadHeaders(ticket.id)),
    ...(await renderTicketClosedEmail({
      brand: await mailBrand(requester),
      ref: ticketRef(ticket.id, ticket.prefix || ticket.type),
      title: ticket.title,
      requesterName: requester.name ?? "",
    })),
  });
}
