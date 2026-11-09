import { NextResponse } from "next/server";
import { getSessionUser, getCurrentUser } from "@/lib/session";
import { checkAiRate } from "@/lib/rate-limit";
import { ProposalSchema } from "@/lib/portal-assistant";
import {
  createPortalTicketFor, createCatalogRequestFor, linkStagedAttachments, addPortalReply, attachDataUrlsToTicket,
  REPLY_RATE_LIMIT_MESSAGE,
} from "@/lib/portal-tickets";
import type { ProposalAttachment } from "@/lib/portal-tickets";
import { ticketRef } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Confirm-to-create endpoint for the portal Sable widget. The user clicks
 * "Create request" on a draft Sable proposed; this re-validates that draft
 * server-side and creates a fully-routed ticket as the signed-in user —
 * either a free-form ticket or a filled catalog order.
 */
export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const row = await getCurrentUser();
  if (!row || !row.isActive) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const limited = checkAiRate(me.id);
  if (limited) {
    return NextResponse.json(
      { error: "Too many requests — please wait a moment." },
      { status: 429, headers: { "retry-after": String(Math.ceil(limited.retryAfterMs / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const parsed = ProposalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please give the request a title and a short description first." }, { status: 400 });
  }

  const rawIds = (body as { attachmentIds?: unknown })?.attachmentIds;
  const attachmentIds = Array.isArray(rawIds) ? rawIds.map(String) : [];

  // Inline `data:` attachments the assistant-ui runtime carried for vision — stored
  // + linked to the ticket server-side (re-validated with the upload allow-list).
  const rawAtts = (body as { attachments?: unknown })?.attachments;
  const attachments: ProposalAttachment[] = Array.isArray(rawAtts)
    ? rawAtts
        .filter((a): a is ProposalAttachment => !!a && typeof (a as ProposalAttachment).dataUrl === "string")
        .map((a) => ({ name: String(a.name ?? "attachment"), type: String(a.type ?? ""), dataUrl: a.dataUrl }))
    : [];

  try {
    if (parsed.data.kind === "comment") {
      const reply = await addPortalReply(me.id, parsed.data.ticketId, parsed.data.body);
      if (!reply.ok) {
        return reply.reason === "RATE_LIMITED"
          ? NextResponse.json({ error: REPLY_RATE_LIMIT_MESSAGE }, { status: 429 })
          : NextResponse.json({ error: "Couldn't post the reply — the ticket may be closed." }, { status: 400 });
      }
      await attachDataUrlsToTicket(me.id, parsed.data.ticketId, attachments);
      return NextResponse.json({ ok: true, id: parsed.data.ticketId, ref: parsed.data.ref, url: `/portal/tickets/${parsed.data.ticketId}`, posted: true });
    }

    if (parsed.data.kind === "service") {
      const answers: Record<string, string> = {};
      for (const a of parsed.data.answers) answers[a.key] = a.value;
      const result = await createCatalogRequestFor(me, parsed.data.itemId, answers, "SABLE");
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.forbidden ? 403 : 400 });
      await linkStagedAttachments(me.id, result.ticket.id, attachmentIds);
      await attachDataUrlsToTicket(me.id, result.ticket.id, attachments);
      return NextResponse.json({
        ok: true,
        id: result.ticket.id,
        ref: ticketRef(result.ticket.id, result.ticket.prefix),
        url: `/portal/tickets/${result.ticket.id}`,
      });
    }

    const ticket = await createPortalTicketFor(me, {
      title: parsed.data.title,
      type: parsed.data.type,
      priority: parsed.data.priority,
      impact: parsed.data.impact,
      urgency: parsed.data.urgency,
      description: parsed.data.description,
      categoryId: parsed.data.categoryId ?? null,
      source: "SABLE",
    });
    await linkStagedAttachments(me.id, ticket.id, attachmentIds);
    await attachDataUrlsToTicket(me.id, ticket.id, attachments);
    return NextResponse.json({
      ok: true,
      id: ticket.id,
      ref: ticketRef(ticket.id, ticket.prefix),
      url: `/portal/tickets/${ticket.id}`,
    });
  } catch (err) {
    console.error("[portal-assistant/create]", err);
    return NextResponse.json({ error: "Couldn't create the request. Please try the request form instead." }, { status: 500 });
  }
}
