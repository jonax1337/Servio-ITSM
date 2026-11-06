import Link from "next/link";
import { Ticket as TicketIcon } from "lucide-react";
import { db } from "@/lib/db";
import { LinkPicker } from "@/components/link-picker";
import { StatusBadge } from "@/components/status-badge";
import { UnlinkIncidentButton } from "@/components/problems/problem-fix-changes";
import { setTicketProblem } from "@/lib/actions/tickets";
import { TICKET_STATUS_META, ticketRef } from "@/lib/constants";

export async function ProblemIncidentsTab({
  problemId,
  isAgentUser,
}: {
  problemId: number;
  isAgentUser: boolean;
}) {
  const [tickets, linkableTickets] = await Promise.all([
    db.ticket.findMany({
      where: { problemId },
      select: { id: true, title: true, prefix: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
    isAgentUser
      ? db.ticket.findMany({
          where: { problemId: null, status: { notIn: ["CLOSED", "CANCELLED"] } },
          select: { id: true, title: true, prefix: true },
          orderBy: { updatedAt: "desc" },
          take: 100,
        })
      : [],
  ]);
  const ticketOpts = linkableTickets.map((t) => ({ value: String(t.id), label: `${ticketRef(t.id, t.prefix)} · ${t.title}` }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <TicketIcon className="size-4 text-muted-foreground" />
          Linked incidents · {tickets.length}
        </h2>
        {isAgentUser ? (
          <LinkPicker
            action={setTicketProblem}
            triggerLabel="Link incident"
            title="Link an incident"
            description="Attach an existing ticket to this problem."
            hidden={{ problemId }}
            valueName="ticketId"
            options={ticketOpts}
            placeholder="Choose a ticket"
            searchPlaceholder="Search tickets…"
            emptyText="No unlinked tickets available."
          />
        ) : null}
      </div>
      {tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No incidents linked to this problem yet.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {tickets.map((t) => (
            <div
              key={t.id}
              className="group/chip flex items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-accent"
            >
              <Link href={`/tickets/${t.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">
                  {ticketRef(t.id, t.prefix)}
                </span>
                <span className="line-clamp-1 flex-1 text-sm font-medium">{t.title}</span>
                <StatusBadge map={TICKET_STATUS_META} value={t.status} />
              </Link>
              {isAgentUser ? <UnlinkIncidentButton ticketId={t.id} /> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
