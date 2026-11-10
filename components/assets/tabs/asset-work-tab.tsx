import Link from "next/link";
import { Ticket as TicketIcon, GitPullRequestArrow, SearchCheck } from "lucide-react";
import { db } from "@/lib/db";
import { StatusBadge } from "@/components/status-badge";
import { LinkPicker } from "@/components/link-picker";
import { UnlinkButton } from "@/components/linked-records";
import {
  linkTicketToAsset, unlinkTicketFromAsset, addAssetToChange, removeAssetFromChange,
} from "@/lib/actions/assets";
import { canAttachToChange, SETTLED_CHANGE_STATUSES } from "@/lib/asset-link-rules";
import { TICKET_STATUS_META, CHANGE_STATUS_META, PROBLEM_STATUS_META, ticketRef, changeRef, problemRef } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";

export async function AssetWorkTab({
  assetId,
  assetStatus,
  isAgentUser,
}: {
  assetId: string;
  assetStatus: string;
  isAgentUser: boolean;
}) {
  const [links, openTickets, openChanges] = await Promise.all([
    db.asset.findUnique({
      where: { id: assetId },
      select: {
        tickets: { include: { ticket: true } },
        changes: { include: { change: { select: { id: true, title: true, status: true } } } },
        problems: { include: { problem: { select: { id: true, title: true, status: true } } } },
      },
    }),
    isAgentUser
      ? db.ticket.findMany({
          where: { status: { notIn: ["CLOSED", "CANCELLED"] } },
          select: { id: true, title: true, prefix: true },
          orderBy: { updatedAt: "desc" },
          take: 200,
        })
      : [],
    isAgentUser
      ? db.change.findMany({
          where: { status: { notIn: [...SETTLED_CHANGE_STATUSES] } },
          select: { id: true, title: true },
          orderBy: { updatedAt: "desc" },
          take: 100,
        })
      : [],
  ]);
  const t = await getT("assets");
  const tickets = links?.tickets ?? [];
  const changes = links?.changes ?? [];
  const problems = links?.problems ?? [];

  const linkedTicketIds = new Set(tickets.map((tk) => tk.ticketId));
  const ticketOpts = openTickets
    .filter((tk) => !linkedTicketIds.has(tk.id))
    .map((tk) => ({ value: String(tk.id), label: `${ticketRef(tk.id, tk.prefix)} · ${tk.title}` }));
  const linkedChangeIds = new Set(changes.map((c) => c.changeId));
  const changeOpts = openChanges
    .filter((c) => !linkedChangeIds.has(c.id))
    .map((c) => ({ value: String(c.id), label: `${changeRef(c.id)} · ${c.title}` }));
  const canAddToChange = canAttachToChange(assetStatus);

  return (
    <>
      {/* Linked tickets */}
      <div>
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <TicketIcon className="size-4 text-muted-foreground" />
            {t("work.ticketsHeading", { count: tickets.length })}
          </h2>
          {isAgentUser ? (
            <LinkPicker
              action={linkTicketToAsset}
              triggerLabel={t("work.linkTicket")}
              title={t("work.linkTicketTitle")}
              description={t("work.linkTicketDescription")}
              hidden={{ assetId }}
              valueName="ticketId"
              options={ticketOpts}
              placeholder={t("work.chooseTicket")}
              searchPlaceholder={t("work.searchTickets")}
              emptyText={t("work.noTicketsAvailable")}
              submitLabel={t("work.linkTicket")}
              successMessage={t("work.ticketLinked")}
            />
          ) : null}
        </div>
        {tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("work.ticketsEmpty")}
          </p>
        ) : (
          <div className="grid gap-2">
            {tickets.map((ta) => (
              <div
                key={ta.ticketId}
                className="group/chip flex items-center rounded-lg border bg-card text-sm hover:border-primary/40"
              >
                <Link href={`/tickets/${ta.ticketId}`} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {ticketRef(ta.ticket.id, ta.ticket.prefix)}
                  </span>
                  <span className="line-clamp-1 flex-1 font-medium">
                    {ta.ticket.title}
                  </span>
                  <StatusBadge map={TICKET_STATUS_META} value={ta.ticket.status} />
                </Link>
                {isAgentUser ? (
                  <UnlinkButton
                    action={unlinkTicketFromAsset}
                    fields={{ assetId, ticketId: ta.ticketId }}
                    successMessage={t("work.ticketUnlinked")}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Changes affecting this asset */}
      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <GitPullRequestArrow className="size-4 text-muted-foreground" />
            {t("work.changesHeading", { count: changes.length })}
          </h2>
          {isAgentUser && canAddToChange ? (
            <LinkPicker
              action={addAssetToChange}
              triggerLabel={t("work.addToChange")}
              title={t("work.addToChangeTitle")}
              description={t("work.addToChangeDescription")}
              hidden={{ assetId }}
              valueName="changeId"
              options={changeOpts}
              placeholder={t("work.chooseChange")}
              searchPlaceholder={t("work.searchChanges")}
              emptyText={t("work.noChangesAvailable")}
              submitLabel={t("work.addToChange")}
              successMessage={t("work.addedToChange")}
            />
          ) : null}
        </div>
        {isAgentUser && !canAddToChange ? (
          <p className="mb-3 text-sm text-muted-foreground">
            {t("work.inactiveHint")}
          </p>
        ) : null}
        {changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("work.changesEmpty")}
          </p>
        ) : (
          <div className="grid gap-2">
            {changes.map((ca) => (
              <div
                key={ca.changeId}
                className="group/chip flex items-center rounded-lg border bg-card text-sm hover:border-primary/40"
              >
                <Link href={`/changes/${ca.changeId}`} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {changeRef(ca.change.id)}
                  </span>
                  <span className="line-clamp-1 flex-1 font-medium">
                    {ca.change.title}
                  </span>
                  <StatusBadge map={CHANGE_STATUS_META} value={ca.change.status} />
                </Link>
                {isAgentUser ? (
                  <UnlinkButton
                    action={removeAssetFromChange}
                    fields={{ assetId, changeId: ca.changeId }}
                    successMessage={t("work.removedFromChange")}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Problems that name this asset as affected (linked from the problem page) */}
      <div className="mt-8">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <SearchCheck className="size-4 text-muted-foreground" />
          {t("work.problemsHeading", { count: problems.length })}
        </h2>
        {problems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("work.problemsEmpty")}</p>
        ) : (
          <div className="grid gap-2">
            {problems.map((pa) => (
              <Link
                key={pa.problemId}
                href={`/problems/${pa.problemId}`}
                className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm hover:border-primary/40"
              >
                <span className="font-mono text-xs text-muted-foreground">{problemRef(pa.problem.id)}</span>
                <span className="line-clamp-1 flex-1 font-medium">{pa.problem.title}</span>
                <StatusBadge map={PROBLEM_STATUS_META} value={pa.problem.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
