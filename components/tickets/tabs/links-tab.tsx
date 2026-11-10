import { notFound } from "next/navigation";
import { AlertTriangle, BookOpen, GitPullRequestArrow, Link2, Server } from "lucide-react";
import { db } from "@/lib/db";
import { LinkPicker } from "@/components/link-picker";
import { LinkButton } from "@/components/link-button";
import { RaiseProblemButton } from "@/components/tickets/raise-problem-dialog";
import { LinkedChip as Chip, UnlinkButton as UnlinkBtn } from "@/components/linked-records";
import { TicketHierarchy } from "@/components/tickets/ticket-hierarchy";
import { RelatedArticlesCard } from "@/components/related-articles-card";
import { RecordAffectedServices } from "@/components/services/affected-services";
import { SimilarTickets } from "@/components/ai/similar-tickets";
import { unlinkTicket, unlinkAsset, unlinkRelation, setTicketProblem, setTicketChange, linkAsset } from "@/lib/actions/tickets";
import { ticketLinkEntries } from "@/lib/ticket-link-labels";
import { canDraftArticleFrom, problemDraftFromTickets } from "@/lib/ticket-drafts";
import { SETTLED_CHANGE_STATUSES } from "@/lib/asset-link-rules";
import { HIERARCHY_PICKER_LIMIT, ancestorChain, descendantIds } from "@/lib/ticket-hierarchy-rules";
import { TONE_TEXT_CLASSES, problemRef, changeRef, ticketRef } from "@/lib/constants";
import type { TicketViewer } from "./ticket-tabs";
import { getT } from "@/lib/i18n/server";

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

/** Links tab: linked records with pickers, affected services, parent / child tickets, similar tickets and related KB articles. */
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
      id: true, prefix: true, type: true, status: true, title: true, description: true,
      problem: { select: { id: true, title: true } },
      change: { select: { id: true } },
      assets: { include: { asset: true } },
      linksFrom: { include: { linked: true } },
      linksTo: { include: { ticket: true } },
    },
  });
  if (!ticket) notFound();
  const t = await getT("tickets");

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
            <Link2 className="size-4 text-muted-foreground" /> {t("links.linkedRecords")}
          </h2>
          {pickers ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {ticket.type === "INCIDENT" && !ticket.problem ? (
                <RaiseProblemButton ticketId={ticketId} draft={problemDraftFromTickets([ticket])} />
              ) : null}
              <LinkPicker
                action={setTicketProblem}
                triggerLabel={t("links.problem")}
                title={t("links.linkProblemTitle")}
                description={t("links.linkProblemDescription")}
                hidden={{ ticketId }}
                valueName="problemId"
                options={pickers.problems}
                placeholder={t("links.chooseProblem")}
                searchPlaceholder={t("links.searchProblems")}
                emptyText={t("links.noProblems")}
                successMessage={t("links.problemLinked")}
              />
              <LinkPicker
                action={setTicketChange}
                triggerLabel={t("links.change")}
                title={t("links.linkChangeTitle")}
                description={t("links.linkChangeDescription")}
                hidden={{ ticketId }}
                valueName="changeId"
                options={pickers.changes}
                placeholder={t("links.chooseChange")}
                searchPlaceholder={t("links.searchChanges")}
                emptyText={t("links.noChanges")}
                successMessage={t("links.changeLinked")}
              />
              <LinkPicker
                action={linkAsset}
                triggerLabel={t("links.asset")}
                title={t("links.linkAssetTitle")}
                description={t("links.linkAssetDescription")}
                hidden={{ ticketId }}
                valueName="assetId"
                options={pickers.assets}
                placeholder={t("links.chooseAsset")}
                searchPlaceholder={t("links.searchAssets")}
                emptyText={t("links.noAssets")}
                successMessage={t("links.assetLinked")}
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
              <Chip key={l.linkId} href={`/tickets/${l.ticket.id}`} icon={<Link2 className={`size-3.5 ${TONE_TEXT_CLASSES.info}`} />} label={`${t.dyn(`linkType.${l.label}`, undefined, l.label)} ${ticketRef(l.ticket.id, l.ticket.prefix)} · ${l.ticket.title}`}
                unlink={<UnlinkBtn action={unlinkTicket} fields={{ linkId: l.linkId }} />} />
            ))}
            {ticket.assets.map((a) => (
              <Chip key={a.assetId} href={`/assets/${a.assetId}`} icon={<Server className={`size-3.5 ${TONE_TEXT_CLASSES.indigo}`} />} label={a.asset.name}
                unlink={<UnlinkBtn action={unlinkAsset} fields={{ ticketId, assetId: a.assetId }} />} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("links.none")}</p>
        )}
      </section>

      {/* Services hit through the linked CIs (read-only) */}
      {viewer.isAgent ? <RecordAffectedServices record={{ kind: "ticket", id: ticketId }} /> : null}

      <TicketHierarchy
        ticketId={ticketId}
        parent={parent}
        childTickets={childTickets}
        parentOptions={pickers?.parents ?? []}
        childOptions={pickers?.children ?? []}
        canEdit={viewer.isAgent}
      />

      {viewer.isAgent ? <SimilarTickets ticketId={ticketId} variant="full" canEdit /> : null}

      <RelatedArticlesCard
        entityType="TICKET"
        entityId={ticketId}
        actions={
          canDraftArticleFrom(ticket.status) ? (
            <LinkButton href={`/knowledge/new?fromTicket=${ticketId}`} variant="outline" size="sm">
              <BookOpen className="size-4" /> {t("links.createArticle")}
            </LinkButton>
          ) : null
        }
      />
    </div>
  );
}
