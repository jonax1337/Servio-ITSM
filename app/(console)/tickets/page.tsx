import { Ticket as TicketIcon, Plus, Download } from "lucide-react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { getSessionUser, hasRole, isAgent, type Role } from "@/lib/session";
import { getVisibleSavedViews } from "@/lib/board-service";
import { SavedViewsBar, type BuiltInView } from "@/components/saved-views-bar";
import { SLA_VIEW_META } from "@/lib/sla-views";
import { TicketsTable } from "@/components/tickets/tickets-table";
import { getParam, getPage, PAGE_SIZE, type SearchParams } from "@/lib/query";
import { findTicketWindow, loadTicketListQuery, TICKET_LIST_PARAMS } from "@/lib/ticket-list";
import { PageHeader, PageBody } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { ListToolbar, type FilterDef } from "@/components/list-toolbar";
import { PaginationBar } from "@/components/pagination-bar";
import { EmptyState } from "@/components/empty-state";
import {
  TICKET_STATUS_META,
  PRIORITY_META,
  TICKET_TYPE_META,
  TICKET_STATUSES,
  PRIORITIES,
  TICKET_TYPES,
} from "@/lib/constants";

export const metadata: Metadata = { title: "Tickets" };
export const dynamic = "force-dynamic";

const BUILT_IN_VIEWS: BuiltInView[] = [
  { id: "sla-breached", name: SLA_VIEW_META.breached.label, icon: "AlarmClockOff", filters: { sla: "breached" } },
  { id: "sla-at-risk", name: SLA_VIEW_META.at_risk.label, icon: "AlarmClock", filters: { sla: "at_risk" } },
];

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = getPage(sp);
  const me = await getSessionUser();
  const [opts, savedViews] = await Promise.all([
    getFormOptions(),
    me ? getVisibleSavedViews("ticket", me.id) : Promise.resolve([]),
  ]);

  // Filters, search and sort live in lib/ticket-list.ts — shared with the CSV export
  // and matching the dashboard widgets' drill-down params.
  const query = await loadTicketListQuery(sp);
  const { where } = query;
  const sort = getParam(sp, "sort") ?? "updatedAt";
  const dir: "asc" | "desc" = getParam(sp, "dir") === "asc" ? "asc" : "desc";

  // "Export CSV" carries the current filters/search/sort through to /api/export.
  const exportParams = new URLSearchParams({ type: "tickets" });
  for (const key of TICKET_LIST_PARAMS) {
    const v = getParam(sp, key);
    // The export's own `type` param picks the export; the ticket-type filter goes as `ticketType`.
    if (v) exportParams.set(key === "type" ? "ticketType" : key, v);
  }
  const exportHref = `/api/export?${exportParams.toString()}`;

  const [total, tickets] = await Promise.all([
    db.ticket.count({ where }),
    findTicketWindow(query, { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }, (args) =>
      db.ticket.findMany({
        ...args,
        include: { assignee: true, requester: true, group: true, category: true },
      }),
    ),
  ]);

  const rows = tickets.map((t) => ({
    id: t.id,
    prefix: t.prefix,
    title: t.title,
    category: t.category?.name ?? null,
    requesterName: t.requester.name ?? t.requester.email,
    requesterVip: t.requester.isVip,
    priority: t.priority,
    status: t.status,
    assignee: t.assignee ? { name: t.assignee.name, email: t.assignee.email } : null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));

  const filters: FilterDef[] = [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "open", label: "Open (active)" },
        ...TICKET_STATUSES.map((s) => ({ value: s, label: TICKET_STATUS_META[s].label })),
      ],
    },
    { key: "priority", label: "Priority", options: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label })) },
    { key: "type", label: "Type", options: TICKET_TYPES.map((t) => ({ value: t, label: TICKET_TYPE_META[t].label })) },
    { key: "group", label: "Group", options: opts.groups.map((g) => ({ value: g.id, label: g.name })) },
    {
      key: "assignee",
      label: "Assignee",
      options: [
        { value: "unassigned", label: "Unassigned" },
        ...opts.agents.map((a) => ({ value: a.id, label: a.name ?? a.email })),
      ],
    },
    { key: "category", label: "Category", options: opts.categories.map((c) => ({ value: c.id, label: c.name })) },
    { key: "service", label: "Service", options: opts.services.map((s) => ({ value: s.id, label: s.name })) },
  ];

  return (
    <>
      <PageHeader
        icon={TicketIcon}
        title="Tickets"
        description="Incidents and service requests across all teams."
      >
        <LinkButton href="/tickets/new">
          <Plus className="size-4" /> New ticket
        </LinkButton>
      </PageHeader>

      <PageBody className="grid gap-4">
        <SavedViewsBar
          entity="ticket"
          basePath="/tickets"
          filterKeys={["q", "status", "priority", "type", "group", "assignee", "category", "service", "sla"]}
          builtInViews={BUILT_IN_VIEWS}
          views={savedViews}
          currentUserId={me?.id ?? ""}
          canManageShared={!!me && hasRole(me.role as Role, "MANAGER")}
          teams={opts.groups.map((g) => ({ value: g.id, label: g.name }))}
        />
        <ListToolbar filters={filters} searchPlaceholder="Search title, description, comments, requester…">
          <LinkButton href={exportHref} variant="outline" size="sm">
            <Download className="size-4" /> Export CSV
          </LinkButton>
        </ListToolbar>

        {tickets.length === 0 ? (
          <EmptyState
            icon={TicketIcon}
            title="No tickets found"
            description="Try adjusting your filters, or create a new ticket to get started."
          >
            <LinkButton href="/tickets/new" size="sm">
              <Plus className="size-4" /> New ticket
            </LinkButton>
          </EmptyState>
        ) : (
          <TicketsTable
            rows={rows}
            sort={sort}
            dir={dir}
            canBulk={!!me && isAgent(me.role as Role)}
            agents={opts.agents.map((a) => ({ value: a.id, label: a.name ?? a.email }))}
            groups={opts.groups.map((g) => ({ value: g.id, label: g.name }))}
          />
        )}

        <PaginationBar
          pathname="/tickets"
          searchParams={sp}
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
        />
      </PageBody>
    </>
  );
}
