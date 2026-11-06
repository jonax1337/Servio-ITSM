import { db } from "@/lib/db";
import { CommentThread } from "@/components/comments/comment-thread";
import { SimilarTickets } from "@/components/ai/similar-tickets";
import { TicketSummaryCard } from "@/components/ai/ticket-summary-card";
import { addTicketComment } from "@/lib/actions/tickets";
import type { FormOptions } from "@/lib/data/options";
import { OPEN_TICKET_STATUSES } from "@/lib/constants";
import { getMaxUploadMb } from "@/lib/settings";
import type { TicketViewer } from "./ticket-tabs";

/** Conversation tab: AI hint and summary slots above the comment thread. Loads the thread data itself. */
export async function ConversationTab({
  ticket, viewer, agents, aiVisible, aiTeaser,
}: {
  ticket: { id: number; status: string; requesterEmail: string; requesterName: string | null };
  viewer: TicketViewer;
  agents: FormOptions["agents"];
  aiVisible: boolean;
  aiTeaser: boolean;
}) {
  const [maxUploadMb, comments, participants, outboundEmails] = await Promise.all([
    getMaxUploadMb(),
    db.ticketComment.findMany({
      where: { ticketId: ticket.id },
      include: { author: true, attachments: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    db.ticketParticipant.findMany({ where: { ticketId: ticket.id }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    // Recipients per sent message, joined by commentId so each reply can show "To: … · Cc: …".
    db.emailMessage.findMany({
      where: { ticketId: ticket.id, commentId: { not: null }, direction: "OUTBOUND" },
      select: { commentId: true, toEmail: true, cc: true },
    }),
  ]);

  const emailByComment = new Map(
    outboundEmails.map((m) => [m.commentId!, { to: m.toEmail, cc: m.cc ? (JSON.parse(m.cc) as string[]) : [] }]),
  );
  const threadComments = comments.map((c) => ({
    id: c.id, author: c.author.name ?? c.author.email, body: c.body, bodyHtml: c.bodyHtml, isInternal: c.isInternal, fromEmail: c.fromEmail, channel: c.channel, createdAt: c.createdAt, attachments: c.attachments,
    recipients: emailByComment.get(c.id) ?? null,
  }));

  // Candidates for the reply To/Cc/Bcc typeahead (value = email): requester + participants + agents, de-duplicated by email.
  const replyCandidates = Array.from(
    new Map(
      [
        { value: ticket.requesterEmail, label: ticket.requesterName ?? ticket.requesterEmail },
        ...participants.map((p) => ({ value: p.user.email, label: p.user.name ?? p.user.email })),
        ...agents.map((a) => ({ value: a.email, label: a.name ?? a.email })),
      ].map((o) => [o.value.toLowerCase(), o]),
    ).values(),
  );

  const isOpen = (OPEN_TICKET_STATUSES as readonly string[]).includes(ticket.status);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {viewer.isAgent ? <TicketSummaryCard ticketId={ticket.id} /> : null}
      {viewer.isAgent && isOpen ? <SimilarTickets ticketId={ticket.id} variant="hint" canEdit /> : null}
      <CommentThread
        idField="ticketId"
        entityId={ticket.id}
        comments={threadComments}
        addAction={addTicketComment}
        mentionUsers={agents}
        attachTarget={{ ticketId: ticket.id }}
        aiTicketId={aiVisible ? ticket.id : undefined}
        aiTeaser={aiTeaser}
        emailReply={{
          requesterEmail: ticket.requesterEmail,
          participantEmails: participants.map((p) => p.user.email),
          candidateUsers: replyCandidates,
        }}
        enableForward
        maxMb={maxUploadMb}
      />
    </div>
  );
}
