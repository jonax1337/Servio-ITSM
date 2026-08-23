"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { sanitizeCommentHtml, htmlToText } from "@/lib/markdown";
import { TICKET_TYPES, PRIORITIES } from "@/lib/constants";
import { createPortalTicketFor, linkStagedAttachments } from "@/lib/portal-tickets";

export type PortalState = { error?: string; fieldErrors?: Record<string, string[]> } | undefined;

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" && v !== "" ? v : null));

const schema = z.object({
  title: z.string().min(3, "Please enter a short summary (min 3 characters)"),
  description: z.string().default(""),
  type: z.enum(TICKET_TYPES).default("INCIDENT"),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  categoryId: optionalId,
  serviceId: optionalId,
});

export async function createPortalTicket(_prev: PortalState, formData: FormData): Promise<PortalState> {
  // DB truth (not the JWT): role/isActive freeze at login, so a deactivated
  // user must lose portal powers even before their token expires.
  const me = await getCurrentUser();
  if (!me || !me.isActive) return { error: "Not authenticated" };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const ticket = await createPortalTicketFor(me, parsed.data);
  await linkStagedAttachments(me.id, ticket.id, formData.getAll("attachmentIds").map(String));
  redirect(`/portal/tickets/${ticket.id}`);
}

export async function addPortalComment(formData: FormData) {
  // DB truth: deactivated users keep no portal powers (see createPortalTicket).
  const me = await getCurrentUser();
  if (!me || !me.isActive) return;
  const id = Number(formData.get("ticketId"));

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

  // Portal users can comment on tickets they requested OR participate in (CC'd).
  const ticket = await db.ticket.findFirst({
    where: { id, OR: [{ requesterId: me.id }, { participants: { some: { userId: me.id } } }] },
  });
  if (!ticket) return;

  // Attach files staged on the requester's own ticket onto this comment (atomic + capped).
  const attachmentIds = formData.getAll("attachmentIds").map(String).filter(Boolean).slice(0, 20);
  await db.$transaction(async (tx) => {
    const c = await tx.ticketComment.create({ data: { ticketId: id, authorId: me.id, body, bodyHtml, isInternal: false } });
    if (attachmentIds.length) {
      await tx.attachment.updateMany({
        where: { id: { in: attachmentIds }, ticketId: id, commentId: null, uploadedById: me.id },
        data: { commentId: c.id, ticketId: null },
      });
    }
  });

  await db.ticket.update({ where: { id }, data: { updatedAt: new Date() } });
  revalidatePath(`/portal/tickets/${id}`);
}
