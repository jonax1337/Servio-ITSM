import Link from "next/link";
import { Ticket as TicketIcon, GitPullRequestArrow } from "lucide-react";
import { db } from "@/lib/db";
import { StatusBadge } from "@/components/status-badge";
import { LinkPicker } from "@/components/link-picker";
import { UnlinkButton } from "@/components/linked-records";
import {
  linkTicketToAsset, unlinkTicketFromAsset, addAssetToChange, removeAssetFromChange,
} from "@/lib/actions/assets";
import { canAttachToChange, SETTLED_CHANGE_STATUSES } from "@/lib/asset-link-rules";
import { TICKET_STATUS_META, CHANGE_STATUS_META, ticketRef, changeRef } from "@/lib/constants";

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
  const tickets = links?.tickets ?? [];
  const changes = links?.changes ?? [];

  const linkedTicketIds = new Set(tickets.map((t) => t.ticketId));
  const ticketOpts = openTickets
    .filter((t) => !linkedTicketIds.has(t.id))
    .map((t) => ({ value: String(t.id), label: `${ticketRef(t.id, t.prefix)} · ${t.title}` }));
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
            Linked tickets · {tickets.length}
          </h2>
          {isAgentUser ? (
            <LinkPicker
              action={linkTicketToAsset}
              triggerLabel="Link ticket"
              title="Link a ticket"
              description="Attach a ticket that involves this configuration item."
              hidden={{ assetId }}
              valueName="ticketId"
              options={ticketOpts}
              placeholder="Choose a ticket"
              searchPlaceholder="Search tickets…"
              emptyText="No more open tickets to link."
              submitLabel="Link ticket"
              successMessage="Ticket linked"
            />
          ) : null}
        </div>
        {tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tickets linked to this asset.
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
                    successMessage="Ticket unlinked"
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
            Changes affecting this asset · {changes.length}
          </h2>
          {isAgentUser && canAddToChange ? (
            <LinkPicker
              action={addAssetToChange}
              triggerLabel="Add to change"
              title="Add to a change"
              description="Mark this configuration item as affected by a change."
              hidden={{ assetId }}
              valueName="changeId"
              options={changeOpts}
              placeholder="Choose a change"
              searchPlaceholder="Search changes…"
              emptyText="No open changes available."
              submitLabel="Add to change"
              successMessage="Added to change"
            />
          ) : null}
        </div>
        {isAgentUser && !canAddToChange ? (
          <p className="mb-3 text-sm text-muted-foreground">
            Retired or disposed assets can&apos;t be added to new changes.
          </p>
        ) : null}
        {changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No changes affect this asset.
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
                    successMessage="Removed from change"
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
