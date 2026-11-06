"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import type { ActionResult } from "@/lib/action-result";
import { ticketRef } from "@/lib/constants";
import { checkReplyRate } from "@/lib/rate-limit";
import { REPLY_RATE_LIMIT_MESSAGE } from "@/lib/portal-tickets";
import { notifyAssigneeAndWatchers } from "@/lib/ticket-core";
import { AFFECTED_NOTE, joinRefusal } from "@/lib/status-rules";

/**
 * "This affects me too": record the signed-in user as affected on the
 * major-incident ticket linked to a PUBLIC, active status incident, instead of
 * them filing a duplicate. Recorded as an internal note, never as a ticket
 * participant: participants see the whole thread in the portal and get its mail.
 * Idempotent; rate-limited like portal replies.
 */
export async function joinStatusIncident(formData: FormData): Promise<ActionResult> {
  // DB truth: a deactivated user keeps no portal powers (see addPortalComment).
  const me = await getCurrentUser();
  if (!me || !me.isActive) return { ok: false, error: "Not authenticated." };

  const incident = await db.statusIncident.findUnique({
    where: { id: String(formData.get("incidentId") ?? "") },
    select: {
      isPublic: true,
      state: true,
      ticket: { select: { id: true, type: true, prefix: true, status: true, isMajorIncident: true, requesterId: true } },
    },
  });
  // A draft is indistinguishable from a missing incident: never confirm it exists.
  if (!incident || !incident.isPublic) return { ok: false, error: "This incident was not found." };
  const refusal = joinRefusal(incident);
  if (refusal || !incident.ticket) return { ok: false, error: refusal ?? "This incident was not found." };

  const ticket = incident.ticket;
  if (ticket.requesterId === me.id) return { ok: true };
  if (checkReplyRate(me.id)) return { ok: false, error: REPLY_RATE_LIMIT_MESSAGE };

  const already = await db.ticketComment.findFirst({
    where: { ticketId: ticket.id, authorId: me.id, isInternal: true, body: AFFECTED_NOTE },
    select: { id: true },
  });
  if (already) return { ok: true };

  const ref = ticketRef(ticket.id, ticket.prefix || ticket.type);
  const who = me.name ?? me.email;
  await db.ticketComment.create({
    data: { ticketId: ticket.id, authorId: me.id, isInternal: true, body: AFFECTED_NOTE },
  });
  await notifyAssigneeAndWatchers(ticket.id, me.id, {
    type: "AFFECTED_USER_REPORTED",
    title: `${who} is also affected by ${ref}`,
    body: "Reported via the portal status page.",
    entity: "Ticket",
    entityId: String(ticket.id),
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: ticket.id, summary: `${who} reported being affected by ${ref} via the status page` });

  revalidatePath(`/tickets/${ticket.id}`);
  revalidatePath("/portal/status");
  revalidatePath("/portal/new");
  return { ok: true };
}
