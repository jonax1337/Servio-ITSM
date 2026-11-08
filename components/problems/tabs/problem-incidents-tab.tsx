import Link from "next/link";
import { Ticket as TicketIcon } from "lucide-react";
import { db } from "@/lib/db";
import { LinkPicker } from "@/components/link-picker";
import { StatusBadge } from "@/components/status-badge";
import { UnlinkIncidentButton } from "@/components/problems/problem-fix-changes";
import { setTicketProblem } from "@/lib/actions/tickets";
import { TICKET_STATUS_META, ticketRef } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";

export async function ProblemIncidentsTab({
  problemId,
  isAgentUser,
}: {
  problemId: number;
  isAgentUser: boolean;
}) {
  const t = await getT("problems");
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
  const ticketOpts = linkableTickets.map((tk) => ({ value: String(tk.id), label: `${ticketRef(tk.id, tk.prefix)} · ${tk.title}` }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <TicketIcon className="size-4 text-muted-foreground" />
          {t("incidents.heading", { count: tickets.length })}
        </h2>
        {isAgentUser ? (
          <LinkPicker
            action={setTicketProblem}
            triggerLabel={t("incidents.link")}
            title={t("incidents.linkTitle")}
            description={t("incidents.linkDescription")}
            hidden={{ problemId }}
            valueName="ticketId"
            options={ticketOpts}
            placeholder={t("incidents.choose")}
            searchPlaceholder={t("incidents.search")}
            emptyText={t("incidents.noneAvailable")}
          />
        ) : null}
      </div>
      {tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("incidents.empty")}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {tickets.map((tk) => (
            <div
              key={tk.id}
              className="group/chip flex items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-accent"
            >
              <Link href={`/tickets/${tk.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">
                  {ticketRef(tk.id, tk.prefix)}
                </span>
                <span className="line-clamp-1 flex-1 text-sm font-medium">{tk.title}</span>
                <StatusBadge map={TICKET_STATUS_META} value={tk.status} />
              </Link>
              {isAgentUser ? <UnlinkIncidentButton ticketId={tk.id} /> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
