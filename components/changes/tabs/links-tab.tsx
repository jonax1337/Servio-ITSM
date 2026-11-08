import Link from "next/link";
import { Server, Ticket as TicketIcon } from "lucide-react";
import { db } from "@/lib/db";
import { LinkedChip, UnlinkButton } from "@/components/linked-records";
import { LinkPicker } from "@/components/link-picker";
import { RelatedArticlesCard } from "@/components/related-articles-card";
import { ChangeProblemChip, ChangeProblemPicker } from "@/components/changes/change-problem-link";
import { setTicketChange } from "@/lib/actions/tickets";
import { problemRef, ticketRef } from "@/lib/constants";
import type { ChangeTabContext } from "@/components/changes/tabs/types";
import { getT } from "@/lib/i18n/server";

const LINK_PICKER_PROBLEM_LIMIT = 200;
const LINK_PICKER_TICKET_LIMIT = 100;

export async function LinksTab({ change, isAgent }: ChangeTabContext) {
  const [problem, tickets, assets, openProblems, linkableTickets] = await Promise.all([
    change.problemId ? db.problem.findUnique({ where: { id: change.problemId } }) : null,
    db.ticket.findMany({ where: { changeId: change.id }, select: { id: true, title: true, prefix: true } }),
    db.changeAsset.findMany({ where: { changeId: change.id }, include: { asset: { select: { name: true } } } }),
    // Pickers are agent-only, so other viewers skip their queries.
    isAgent
      ? db.problem.findMany({
          where: { status: { not: "CLOSED" } },
          select: { id: true, title: true },
          orderBy: { updatedAt: "desc" },
          take: LINK_PICKER_PROBLEM_LIMIT,
        })
      : [],
    isAgent
      ? db.ticket.findMany({
          where: { changeId: null, status: { notIn: ["CLOSED", "CANCELLED"] } },
          select: { id: true, title: true, prefix: true },
          orderBy: { updatedAt: "desc" },
          take: LINK_PICKER_TICKET_LIMIT,
        })
      : [],
  ]);

  const t = await getT("changes");
  const problemOpts = openProblems
    .filter((p) => p.id !== change.problemId)
    .map((p) => ({ value: String(p.id), label: `${problemRef(p.id)} · ${p.title}` }));
  const ticketOpts = linkableTickets.map((t) => ({ value: String(t.id), label: `${ticketRef(t.id, t.prefix)} · ${t.title}` }));

  return (
    <div className="grid gap-6">
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <TicketIcon className="size-4 text-muted-foreground" /> {t("links.title")}
          </h2>
          {isAgent ? (
            <div className="flex items-center gap-2">
              <ChangeProblemPicker changeId={change.id} options={problemOpts} />
              <LinkPicker
                action={setTicketChange}
                triggerLabel={t("links.linkIncident")}
                title={t("links.linkIncidentTitle")}
                description={t("links.linkIncidentDescription")}
                hidden={{ changeId: change.id }}
                valueName="ticketId"
                options={ticketOpts}
                placeholder={t("links.chooseTicket")}
                searchPlaceholder={t("links.searchTickets")}
                emptyText={t("links.noTickets")}
              />
            </div>
          ) : null}
        </div>
        {problem || tickets.length > 0 || assets.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {problem ? (
              <ChangeProblemChip
                changeId={change.id}
                problemId={problem.id}
                label={`${problemRef(problem.id)} · ${problem.title}`}
                editable={isAgent}
              />
            ) : null}
            {tickets.map((t) => (
              <LinkedChip
                key={t.id}
                href={`/tickets/${t.id}`}
                icon={<TicketIcon className="size-3.5 text-primary" />}
                label={`${ticketRef(t.id, t.prefix)} · ${t.title}`}
                unlink={isAgent ? <UnlinkButton action={setTicketChange} fields={{ ticketId: t.id, changeId: "" }} /> : undefined}
              />
            ))}
            {assets.map((a) => (
              <Link key={a.assetId} href={`/assets/${a.assetId}`} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs hover:border-primary/40">
                <Server className="size-3.5 text-primary" /> {a.asset.name}
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("links.empty")}</p>
        )}
      </section>

      <RelatedArticlesCard entityType="CHANGE" entityId={change.id} />
    </div>
  );
}
