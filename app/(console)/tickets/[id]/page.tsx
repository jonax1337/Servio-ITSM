import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Activity, ArrowLeft, Flame, GitMerge, CheckCircle2, Network } from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions, type FormOptions } from "@/lib/data/options";
import { loadBusinessCalendar, slaSnapshot } from "@/lib/sla";
import { allowedTransitions } from "@/lib/workflow";
import { approvalAllowsStatus } from "@/lib/transitions";
import { requireUser, isAgent, hasRole, type Role } from "@/lib/session";
import type { SearchParams } from "@/lib/query";
import { LinkButton } from "@/components/link-button";
import { StatusBadge, VipBadge, ToneBadge } from "@/components/status-badge";
import { TicketProperties } from "@/components/tickets/ticket-properties";
import { FormAnswers } from "@/components/tickets/form-answers";
import { EntityTabs, resolveTab } from "@/components/entity-tabs";
import { ConversationTab } from "@/components/tickets/tabs/conversation-tab";
import { DetailsTab } from "@/components/tickets/tabs/details-tab";
import { LinksTab } from "@/components/tickets/tabs/links-tab";
import { WorkTab } from "@/components/tickets/tabs/work-tab";
import { ApprovalsTab } from "@/components/tickets/tabs/approvals-tab";
import { HistoryTab } from "@/components/tickets/tabs/history-tab";
import { TabSkeleton } from "@/components/tickets/tabs/tab-skeleton";
import {
  DEFAULT_TICKET_TAB, ticketLinkCount, ticketTabs,
  type TicketTabKey, type TicketViewer,
} from "@/components/tickets/tabs/ticket-tabs";
import { aiConfigured, aiTeaserEnabled } from "@/lib/ai";
import { getBoolSetting } from "@/lib/settings";
import { EditEntityDialog } from "@/components/edit-entity-dialog";
import { updateTicketDetails, unmergeTicket } from "@/lib/actions/tickets";
import { ConfirmButton } from "@/components/confirm-dialog";
import { TicketActions } from "@/components/tickets/ticket-actions";
import { MacroPicker } from "@/components/tickets/macro-picker";
import { openChildren } from "@/lib/ticket-hierarchy-rules";
import { canDraftArticleFrom, problemDraftFromTickets } from "@/lib/ticket-drafts";
import { SlaBadge } from "@/components/tickets/sla-badge";
import { UserAvatar } from "@/components/user-avatar";
import { sanitizeCommentHtml } from "@/lib/markdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TICKET_STATUS_META, PRIORITY_META, TICKET_TYPE_META, SOURCE_META,
  PENDING_REASON_META, RESOLUTION_CODE_META, metaFor,
  ticketRef,
  TONE_BANNER_CLASSES, TONE_TEXT_CLASSES,
} from "@/lib/constants";
import { format, formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

const RELATED_TICKET_SELECT = { id: true, title: true, prefix: true, status: true } as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const t = await db.ticket.findUnique({ where: { id: Number(id) }, select: { title: true } });
  return { title: t ? t.title : "Ticket" };
}

export default async function TicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ticketId = Number(id);
  if (!Number.isFinite(ticketId)) notFound();

  const me = await requireUser();
  const isAgentUser = !!me && isAgent(me.role as Role);
  const viewer: TicketViewer = {
    id: me?.id,
    isAgent: isAgentUser,
    isAdmin: me?.role === "ADMIN",
    canManage: !!me && hasRole(me.role as Role, "MANAGER"),
  };

  // Only what the header, the rail and the tab bar need; each tab loads its own data.
  const [ticket, options, candidates, macros, openTaskCount, pendingApprovalCount, statusIncident] = await Promise.all([
    db.ticket.findUnique({
      where: { id: ticketId },
      include: {
        requester: true,
        requestedBy: true,
        sla: true,
        mergedInto: true,
        parent: { select: RELATED_TICKET_SELECT },
        children: { select: RELATED_TICKET_SELECT, orderBy: { id: "asc" } },
        catalogItem: { select: { formSchema: true } },
        watchers: { include: { user: true } },
        _count: { select: { comments: true, attachments: true, participants: true, assets: true, linksFrom: true, linksTo: true } },
      },
    }),
    getFormOptions(),
    db.ticket.findMany({
      where: { id: { not: ticketId }, status: { notIn: ["CLOSED", "CANCELLED"] } },
      select: { id: true, title: true, prefix: true },
      orderBy: { updatedAt: "desc" },
      take: 60,
    }),
    // Macros the current agent may apply here: any shared macro + their own personal ones.
    isAgentUser
      ? db.macro.findMany({
          where: { OR: [{ isShared: true }, { ownerId: me.id }] },
          select: { id: true, name: true, description: true, isShared: true, actions: true },
          orderBy: [{ isShared: "desc" }, { name: "asc" }],
        })
      : [],
    isAgentUser ? db.task.count({ where: { ticketId, done: false } }) : 0,
    isAgentUser
      ? db.approval.count({ where: { entityType: "TICKET", entityId: String(ticketId), status: "PENDING" } })
      : 0,
    isAgentUser
      ? db.statusIncident.findUnique({ where: { ticketId }, select: { id: true, isPublic: true } })
      : null,
  ]);
  if (!ticket) notFound();

  const tabs = ticketTabs(
    {
      comments: ticket._count.comments,
      links: ticketLinkCount({
        hasProblem: ticket.problemId !== null,
        hasChange: ticket.changeId !== null,
        hasParent: ticket.parent !== null,
        childTickets: ticket.children.length,
        linkedTickets: ticket._count.linksFrom + ticket._count.linksTo,
        assets: ticket._count.assets,
      }),
      openTasks: openTaskCount,
      pendingApprovals: pendingApprovalCount,
      details: ticket._count.attachments + ticket._count.participants,
    },
    isAgentUser,
  );
  const activeTab = resolveTab(sp, tabs, DEFAULT_TICKET_TAB);

  // SLA badge in BUSINESS time: when the ticket's SLA carries a business
  // calendar, compute the live state against working hours so the badge agrees
  // with the escalation sweep (lib/sla-escalation.ts). `loadBusinessCalendar`
  // returns null for no/always-open calendars, so `slaSnapshot` transparently
  // falls back to wall-clock in that case.
  const slaCalendar = await loadBusinessCalendar(ticket.sla?.businessCalendarId);
  const slaState = slaSnapshot(ticket, undefined, slaCalendar).state;

  const aiEnabled = await aiConfigured();
  const aiTeaser = !aiEnabled && (await aiTeaserEnabled()); // show buttons as a preview when disabled
  const aiVisible = aiEnabled || aiTeaser;
  // Admins can turn off the inline triage suggestions independently of the rest.
  const triageEnabled = aiEnabled && (await getBoolSetting("AI_TICKET_TRIAGE", true));
  const isWatching = !!me && ticket.watchers.some((w) => w.userId === me.id);
  const allowedStatuses = me
    ? [...await allowedTransitions("TICKET", ticket.status, me.role as Role)].filter((s) => approvalAllowsStatus(ticket.approvalState, s))
    : undefined;
  const candidateOpts = candidates.map((c) => ({
    value: String(c.id),
    label: `${ticketRef(c.id, c.prefix)} — ${c.title}`,
  }));
  const pickerMacros = macros.map((m) => {
    let actionCount = 0;
    try {
      const parsed = JSON.parse(m.actions) as unknown;
      if (Array.isArray(parsed)) actionCount = parsed.length;
    } catch { /* malformed macro → 0 actions */ }
    return { id: m.id, name: m.name, description: m.description, isShared: m.isShared, actionCount };
  });

  return (
    <div data-viewport-pane className="grid gap-0 lg:h-full grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
      {/* Main column — scrolls independently from the properties rail */}
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
          <LinkButton href="/tickets" variant="ghost" size="icon-sm" aria-label="Back to tickets">
            <ArrowLeft className="size-4" />
          </LinkButton>
          <span className="font-mono text-sm text-muted-foreground">
            {ticketRef(ticket.id, ticket.prefix)}
          </span>
          <StatusBadge map={TICKET_TYPE_META} value={ticket.type} />
          <StatusBadge map={PRIORITY_META} value={ticket.priority} />
          <StatusBadge map={TICKET_STATUS_META} value={ticket.status} />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {isAgentUser ? <MacroPicker ticketId={ticket.id} macros={pickerMacros} /> : null}
            <EditEntityDialog
              action={updateTicketDetails}
              idField="id"
              id={ticket.id}
              title={ticket.title}
              description={ticket.description}
              descriptionHtml={ticket.descriptionHtml}
              entityLabel="ticket"
            />
            <TicketActions
              ticketId={ticket.id}
              isWatching={isWatching}
              isMajorIncident={ticket.isMajorIncident}
              candidates={candidateOpts}
              watchers={ticket.watchers.map((w) => w.user.name ?? w.user.email)}
              problemDraft={isAgentUser && ticket.type === "INCIDENT" && ticket.problemId === null ? problemDraftFromTickets([ticket]) : null}
              canDraftArticle={isAgentUser && canDraftArticleFrom(ticket.status)}
              people={options.agents
                .filter((a) => a.id !== me?.id)
                .map((a) => ({ value: a.id, label: a.name ?? a.email }))}
            />
          </div>
        </div>

        {ticket.isMajorIncident ? (
          <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive sm:px-6">
            <Flame className="size-4" /> Major Incident — all hands. Stakeholders are being notified.
            {statusIncident ? (
              <span className="ml-auto font-normal">
                Status page: {statusIncident.isPublic ? "Public" : "Draft"} ·{" "}
                <Link href={`/status/${statusIncident.id}`} className="font-medium underline">Open</Link>
              </span>
            ) : isAgentUser ? (
              <Link href={`/status/new?ticket=${ticketId}`} className="ml-auto font-medium underline">
                Create status incident
              </Link>
            ) : null}
          </div>
        ) : null}

        {statusIncident && !ticket.isMajorIncident ? (
          <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-sm sm:px-6">
            <Activity className="size-4 text-muted-foreground" />
            Status page: {statusIncident.isPublic ? "Public" : "Draft"} ·{" "}
            <Link href={`/status/${statusIncident.id}`} className="font-medium text-primary hover:underline">Open</Link>
          </div>
        ) : null}

        {ticket.pendingReason && (ticket.status === "PENDING" || ticket.status === "ON_HOLD") ? (
          <div className={`flex flex-wrap items-center gap-2 border-b ${TONE_BANNER_CLASSES.warning} px-4 py-2.5 text-sm sm:px-6`}>
            <ToneBadge meta={metaFor(PENDING_REASON_META, ticket.pendingReason)} />
            {ticket.pendingNote ? <span className="text-muted-foreground">{ticket.pendingNote}</span> : null}
          </div>
        ) : null}

        {ticket.resolutionNote && ["RESOLVED", "CLOSED", "CANCELLED"].includes(ticket.status) ? (
          <div className={`flex flex-wrap items-center gap-2 border-b ${TONE_BANNER_CLASSES.success} px-4 py-2.5 text-sm sm:px-6`}>
            {ticket.resolutionCode ? (
              <ToneBadge meta={metaFor(RESOLUTION_CODE_META, ticket.resolutionCode)} />
            ) : (
              <CheckCircle2 className={`size-4 ${TONE_TEXT_CLASSES.success}`} />
            )}
            <span className="text-muted-foreground">{ticket.resolutionNote}</span>
          </div>
        ) : null}

        {ticket.mergedInto ? (
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-2.5 text-sm sm:px-6">
            <GitMerge className="size-4 text-muted-foreground" />
            <span>
              This ticket was merged into{" "}
              <Link href={`/tickets/${ticket.mergedInto.id}`} className="font-medium text-primary hover:underline">
                {ticketRef(ticket.mergedInto.id, ticket.mergedInto.prefix)}
              </Link>
              .
            </span>
            {isAgentUser ? (
              <ConfirmButton
                action={unmergeTicket}
                fields={{ id: ticket.id }}
                title="Undo merge?"
                description={`This ticket is restored as it was before the merge, and what the merge carried over to ${ticketRef(ticket.mergedInto.id, ticket.mergedInto.prefix)} is removed again.`}
                confirmLabel="Undo merge"
                confirmVariant="default"
                triggerVariant="outline"
                triggerSize="sm"
                triggerClassName="ml-auto"
                successMessage="Merge undone"
              >
                Undo merge
              </ConfirmButton>
            ) : null}
          </div>
        ) : null}

        {ticket.parent ? (
          <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2.5 text-sm sm:px-6">
            <Network className="size-4 text-muted-foreground" />
            Part of{" "}
            <Link href={`/tickets/${ticket.parent.id}`} className="font-medium text-primary hover:underline">
              {ticketRef(ticket.parent.id, ticket.parent.prefix)}
            </Link>
            (parent) &middot; {ticket.parent.title}
          </div>
        ) : null}

        <div className="p-4 sm:p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight wrap-anywhere">
            {ticket.title}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span>Opened by {ticket.requester.name ?? ticket.requester.email}</span>
            {ticket.requester.isVip ? <VipBadge className="align-middle" /> : null}
            <span>· {formatDistanceToNow(ticket.createdAt, { addSuffix: true })} · via</span>
            <StatusBadge map={SOURCE_META} value={ticket.source} />
          </p>

          <div className="mt-4 rounded-xl border bg-card p-4 text-sm leading-relaxed">
            {ticket.descriptionHtml ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none wrap-anywhere prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto"
                dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(ticket.descriptionHtml) }}
              />
            ) : ticket.description ? (
              <div className="whitespace-pre-wrap wrap-anywhere">{ticket.description}</div>
            ) : (
              <span className="text-muted-foreground">No description provided.</span>
            )}
          </div>

          {/* A catalog request's answers are the brief for whoever works it, so they stay above the tabs. */}
          {ticket.formData ? (
            <FormAnswers className="mt-4" formSchema={ticket.formSchema ?? ticket.catalogItem?.formSchema} formData={ticket.formData} />
          ) : null}

          <EntityTabs
            className="mt-6"
            tabs={tabs}
            active={activeTab}
            defaultTab={DEFAULT_TICKET_TAB}
            basePath={`/tickets/${ticket.id}`}
            searchParams={sp}
            label="Ticket sections"
          />

          <div className="mt-5">
            <Suspense key={activeTab} fallback={<TabSkeleton />}>
              <ActiveTab
                active={activeTab}
                ticket={ticket}
                viewer={viewer}
                agents={options.agents}
                aiVisible={aiVisible}
                aiTeaser={aiTeaser}
              />
            </Suspense>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
        {/* SLA first — the clock is the most time-sensitive thing to see */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Timeline & SLA</CardTitle></CardHeader>
          <CardContent className="grid gap-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">SLA status</span>
              <SlaBadge ticket={ticket} state={slaState} />
            </div>
            <Meta label="Created" value={format(ticket.createdAt, "PP p")} />
            {ticket.responseDueAt && !ticket.firstResponseAt ? <Meta label="Respond by" value={format(ticket.responseDueAt, "PP p")} /> : null}
            {ticket.dueAt ? <Meta label="Resolve by" value={format(ticket.dueAt, "PP p")} /> : null}
            {ticket.firstResponseAt ? <Meta label="First response" value={format(ticket.firstResponseAt, "PP p")} /> : null}
            {ticket.resolvedAt ? <Meta label="Resolved" value={format(ticket.resolvedAt, "PP p")} /> : null}
            {ticket.sla ? <Meta label="SLA" value={ticket.sla.name} /> : null}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader><CardTitle className="text-sm">Properties</CardTitle></CardHeader>
          <CardContent>
            <TicketProperties ticket={ticket} options={options} openChildCount={openChildren(ticket.children).length} aiEnabled={aiVisible} aiTeaser={aiTeaser} triageEnabled={triageEnabled} allowedStatuses={allowedStatuses} />
          </CardContent>
        </Card>

        {/* Requester — a clickable user card that opens their profile (their open
            tickets + assigned assets). Watchers are surfaced via the Watch button. */}
        <Card className="mt-4">
          <CardHeader><CardTitle className="text-sm">Requester</CardTitle></CardHeader>
          <CardContent>
            <Link
              href={`/people/${ticket.requesterId}`}
              className="group flex items-center gap-3 rounded-lg border p-2.5 transition-colors hover:border-primary/40"
            >
              <UserAvatar name={ticket.requester.name} email={ticket.requester.email} image={ticket.requester.image} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium group-hover:text-primary">
                    {ticket.requester.name ?? ticket.requester.email}
                  </span>
                  {ticket.requester.isVip ? <VipBadge label={false} /> : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{ticket.requester.email}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                View →
              </span>
            </Link>
            {ticket.requestedBy ? (
              <Link
                href={`/people/${ticket.requestedByUserId}`}
                className="mt-2 flex items-center gap-2 rounded-lg border border-dashed p-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <UserAvatar name={ticket.requestedBy.name} email={ticket.requestedBy.email} image={ticket.requestedBy.image} size="sm" />
                <span className="min-w-0 flex-1 truncate">
                  Raised by {ticket.requestedBy.name ?? ticket.requestedBy.email} on their behalf
                </span>
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </aside>

      {/* Sable lives in the global window (FAB / SableProvider) — it detects this
          ticket from the URL and opens the same assistant with ticket context. */}
    </div>
  );
}

/** The panel of the active tab; `resolveTab` already ruled out agent-only tabs for other viewers. */
function ActiveTab({
  active, ticket, viewer, agents, aiVisible, aiTeaser,
}: {
  active: TicketTabKey;
  ticket: {
    id: number;
    title: string;
    status: string;
    requester: { email: string; name: string | null };
    parent: { id: number; title: string; prefix: string; status: string } | null;
    children: { id: number; title: string; prefix: string; status: string }[];
  };
  viewer: TicketViewer;
  agents: FormOptions["agents"];
  aiVisible: boolean;
  aiTeaser: boolean;
}) {
  switch (active) {
    case "conversation":
      return (
        <ConversationTab
          ticket={{ id: ticket.id, status: ticket.status, requesterEmail: ticket.requester.email, requesterName: ticket.requester.name }}
          viewer={viewer}
          agents={agents}
          aiVisible={aiVisible}
          aiTeaser={aiTeaser}
        />
      );
    case "details":
      return <DetailsTab ticketId={ticket.id} viewer={viewer} />;
    case "links":
      return <LinksTab ticketId={ticket.id} parent={ticket.parent} childTickets={ticket.children} viewer={viewer} />;
    case "work":
      return <WorkTab ticketId={ticket.id} viewer={viewer} />;
    case "approvals":
      return <ApprovalsTab ticket={ticket} viewer={viewer} agents={agents} />;
    case "history":
      return <HistoryTab ticketId={ticket.id} />;
  }
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  );
}
