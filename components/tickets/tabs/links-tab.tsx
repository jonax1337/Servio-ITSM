import { notFound } from "next/navigation";
import { AlertTriangle, GitPullRequestArrow, Link2, Server } from "lucide-react";
import { db } from "@/lib/db";
import { LinkPicker } from "@/components/link-picker";
import { LinkedChip as Chip, UnlinkButton as UnlinkBtn } from "@/components/linked-records";
import { TicketHierarchy } from "@/components/tickets/ticket-hierarchy";
import { RelatedArticlesCard } from "@/components/related-articles-card";
import { SimilarTickets } from "@/components/ai/similar-tickets";
import { unlinkTicket, unlinkAsset, unlinkRelation, setTicketProblem, setTicketChange, linkAsset } from "@/lib/actions/tickets";
import { ticketLinkEntries } from "@/lib/ticket-link-labels";
import { SETTLED_CHANGE_STATUSES } from "@/lib/asset-link-rules";
import { HIERARCHY_PICKER_LIMIT, ancestorChain, descendantIds } from "@/lib/ticket-hierarchy-rules";
import { TONE_TEXT_CLASSES, problemRef, changeRef, ticketRef } from "@/lib/constants";
import type { TicketViewer } from "./ticket-tabs";

type RelatedTicket = { id: number; title: string; prefix: string; status: string };

/** Agent-only: the candidates the link and hierarchy pickers offer. */
async function loadPickerOptions(ticketId: number, linkedAssetIds: Set<string>) {
  const [problems, changes, assets, hierarchyCandidates, hierarchyEdges] = await Promise.all([
    db.problem.findMany({
      where: { status: { notIn: ["RESOLVED", "CLOSED"] } },
      select: { id: true, title: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    db.change.findMany({
      where: { status: { notIn: [...SETTLED_CHANGE_STATUSES] } },
      select: { id: true, title: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    db.asset.findMany({
      select: { id: true, name: true, assetTag: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    // Only tickets that can take part in a hierarchy, and more of them than the general
    // pickers offer (the parent is often an older major incident).
    db.ticket.findMany({
      where: { id: { not: ticketId }, status: { notIn: ["CLOSED", "CANCELLED"] }, mergedIntoId: null },
      select: { id: true, title: true, prefix: true },
      orderBy: { updatedAt: "desc" },
      take: HIERARCHY_PICKER_LIMIT,
    }),
    db.ticket.findMany({ where: { parentId: { not: null } }, select: { id: true, parentId: true } }),
  ]);

  // What parentLinkRefusal would reject is left out: a parent may not be a descendant, a child may not be an ancestor.
  const hierarchyOpts = hierarchyCandidates.map((c) => ({ id: c.id, value: String(c.id), label: `${ticketRef(c.id, c.prefix)} — ${c.title}` }));
  const descendants = descendantIds(ticketId, hierarchyEdges);
  const ancestors = new Set(ancestorChain(ticketId, hierarchyEdges));

  return {
    problems: problems.map((p) => ({ value: String(p.id), label: `${problemRef(p.id)} · ${p.title}` })),
    changes: changes.map((c) => ({ value: String(c.id), label: `${changeRef(c.id)} · ${c.title}` })),
    assets: assets
      .filter((a) => !linkedAssetIds.has(a.id))
      .map((a) => ({ value: a.id, label: a.assetTag ? `${a.name} · ${a.assetTag}` : a.name })),
    parents: hierarchyOpts.filter((o) => !descendants.has(o.id)),
    children: hierarchyOpts.filter((o) => !ancestors.has(o.id) && !descendants.has(o.id)),
  };
}

/** Links tab: linked records with pickers, parent / child tickets, similar tickets and related KB articles. */
export async function LinksTab({
  ticketId, parent, childTickets, viewer,
}: {
  ticketId: number;
  parent: RelatedTicket | null;
  childTickets: RelatedTicket[];
  viewer: TicketViewer;
}) {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: {
      problem: { select: { id: true, title: true } },
      change: { select: { id: true } },
      assets: { include: { asset: true } },
      linksFrom: { include: { linked: true } },
      linksTo: { include: { ticket: true } },
    },
  });
  if (!ticket) notFound();

  const linkedTickets = ticketLinkEntries(ticket.linksFrom, ticket.linksTo);
  const pickers = viewer.isAgent
    ? await loadPickerOptions(ticketId, new Set(ticket.assets.map((a) => a.assetId)))
    : null;

  // TicketHierarchy brings its own top margin; the grid gap spaces the sections instead.
  return (
    <div className="grid gap-6 [&>.mt-6]:mt-0">
      {/* Linked records — problems, changes, tickets and assets, with add + unlink */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="size-4 text-muted-foreground" /> Linked records
          </h2>
          {pickers ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <LinkPicker
                action={setTicketProblem}
                triggerLabel="Problem"
                title="Link to problem"
                description="Connect this incident to a known problem."
                hidden={{ ticketId }}
                valueName="problemId"
                options={pickers.problems}
                placeholder="Choose a problem"
                searchPlaceholder="Search problems…"
                emptyText="No open problems to link."
                successMessage="Problem linked"
              />
              <LinkPicker
                action={setTicketChange}
                triggerLabel="Change"
                title="Link to change"
                description="Connect this ticket to a change request."
                hidden={{ ticketId }}
                valueName="changeId"
                options={pickers.changes}
                placeholder="Choose a change"
                searchPlaceholder="Search changes…"
                emptyText="No open changes to link."
                successMessage="Change linked"
              />
              <LinkPicker
                action={linkAsset}
                triggerLabel="Asset"
                title="Link an asset"
                description="Attach an affected configuration item."
                hidden={{ ticketId }}
                valueName="assetId"
                options={pickers.assets}
                placeholder="Choose an asset"
                searchPlaceholder="Search assets…"
                emptyText="No more assets to link."
                successMessage="Asset linked"
              />
            </div>
          ) : null}
        </div>
        {ticket.problem || ticket.change || ticket.assets.length > 0 || linkedTickets.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {ticket.problem ? (
              <Chip href={`/problems/${ticket.problem.id}`} icon={<AlertTriangle className={`size-3.5 ${TONE_TEXT_CLASSES.warning}`} />} label={`${problemRef(ticket.problem.id)} · ${ticket.problem.title}`}
                unlink={<UnlinkBtn action={unlinkRelation} fields={{ ticketId, kind: "problem" }} />} />
            ) : null}
            {ticket.change ? (
              <Chip href={`/changes/${ticket.change.id}`} icon={<GitPullRequestArrow className="size-3.5 text-primary" />} label={changeRef(ticket.change.id)}
                unlink={<UnlinkBtn action={unlinkRelation} fields={{ ticketId, kind: "change" }} />} />
            ) : null}
            {linkedTickets.map((l) => (
              <Chip key={l.linkId} href={`/tickets/${l.ticket.id}`} icon={<Link2 className={`size-3.5 ${TONE_TEXT_CLASSES.info}`} />} label={`${l.label} ${ticketRef(l.ticket.id, l.ticket.prefix)} · ${l.ticket.title}`}
                unlink={<UnlinkBtn action={unlinkTicket} fields={{ linkId: l.linkId }} />} />
            ))}
            {ticket.assets.map((a) => (
              <Chip key={a.assetId} href={`/assets/${a.assetId}`} icon={<Server className={`size-3.5 ${TONE_TEXT_CLASSES.indigo}`} />} label={a.asset.name}
                unlink={<UnlinkBtn action={unlinkAsset} fields={{ ticketId, assetId: a.assetId }} />} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No linked records yet.</p>
        )}
      </section>

      <TicketHierarchy
        ticketId={ticketId}
        parent={parent}
        childTickets={childTickets}
        parentOptions={pickers?.parents ?? []}
        childOptions={pickers?.children ?? []}
        canEdit={viewer.isAgent}
      />

      {viewer.isAgent ? <SimilarTickets ticketId={ticketId} variant="full" canEdit /> : null}

      <RelatedArticlesCard entityType="TICKET" entityId={ticketId} />
    </div>
  );
}
