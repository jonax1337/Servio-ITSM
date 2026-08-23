import { Ticket as TicketIcon, Plus, Download } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { getSessionUser, hasRole, isAgent, type Role } from "@/lib/session";
import { getVisibleSavedViews } from "@/lib/board-service";
import { SavedViewsBar } from "@/components/saved-views-bar";
import { TicketsTable } from "@/components/tickets/tickets-table";
import { buildTicketWhere } from "@/lib/dashboard/compute";
import type { TicketFilters } from "@/lib/dashboard/types";
import { getParam, getPage, PAGE_SIZE, type SearchParams } from "@/lib/query";
import { applyTicketSearch } from "@/lib/search";
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

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = getPage(sp);
  const q = getParam(sp, "q");
  const status = getParam(sp, "status");
  const priority = getParam(sp, "priority");
  const type = getParam(sp, "type");
  const group = getParam(sp, "group");
  const assignee = getParam(sp, "assignee");
  const me = await getSessionUser();
  const [opts, savedViews] = await Promise.all([
    getFormOptions(),
    me ? getVisibleSavedViews("ticket", me.id) : Promise.resolve([]),
  ]);

  // Build the filter from ALL supported params via the shared builder, so dashboard
  // widget links (which carry the same params) drill down into an exact match.
  const filterParams: TicketFilters = {
    status, priority, type, group, assignee,
    category: getParam(sp, "category"),
    service: getParam(sp, "service"),
    impact: getParam(sp, "impact"),
    urgency: getParam(sp, "urgency"),
    source: getParam(sp, "source"),
    major: getParam(sp, "major"),
    vip: getParam(sp, "vip"),
    breached: getParam(sp, "breached"),
  };
  const where: Prisma.TicketWhereInput = buildTicketWhere(filterParams);
  // Cross-field text search (title/description/comments/requester/custom-fields)
  // AND'd onto the active filters so search narrows the list. See lib/search.ts.
  applyTicketSearch(where, q);

  // Sorting (URL-driven, so it survives pagination + filters).
  const sort = getParam(sp, "sort") ?? "updatedAt";
  const dir: "asc" | "desc" = getParam(sp, "dir") === "asc" ? "asc" : "desc";
  const ORDER: Record<string, Prisma.TicketOrderByWithRelationInput> = {
    id: { id: dir },
    title: { title: dir },
    status: { status: dir },
    priority: { priority: dir },
    updatedAt: { updatedAt: dir },
    createdAt: { createdAt: dir },
    requester: { requester: { name: dir } },
    assignee: { assignee: { name: dir } },
  };
  const orderBy = ORDER[sort] ?? ORDER.updatedAt;

  // "Export CSV" carries the current filters/search/sort through to the shared
  // /api/export endpoint (type=tickets), which streams a csvResponse(...).
  const exportParams = new URLSearchParams({ type: "tickets" });
  for (const key of ["q", "status", "priority", "type", "group", "assignee", "category", "service", "sort", "dir"]) {
    const v = getParam(sp, key);
    if (v) exportParams.set(key, v);
  }
  const exportHref = `/api/export?${exportParams.toString()}`;

  const [total, tickets] = await Promise.all([
    db.ticket.count({ where }),
    db.ticket.findMany({
      where,
      include: { assignee: true, requester: true, group: true, category: true },
      orderBy: [orderBy],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
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
          filterKeys={["q", "status", "priority", "type", "group", "assignee", "category", "service"]}
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
