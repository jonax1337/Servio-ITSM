import { Ticket as TicketIcon, Plus, Download } from "lucide-react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { getSessionUser, hasRole, isAgent, type Role } from "@/lib/session";
import { getVisibleSavedViews } from "@/lib/board-service";
import { SavedViewsBar } from "@/components/saved-views-bar";
import { SLA_VIEWS, SLA_VIEW_META, activeSlaClocks } from "@/lib/sla-views";
import { slaCell } from "@/lib/sla-column";
import { SAVED_VIEW_KEYS } from "@/lib/saved-view-filters";
import { TicketsTable } from "@/components/tickets/tickets-table";
import { getParam, getPage, PAGE_SIZE, type SearchParams } from "@/lib/query";
import { findTicketWindow, loadTicketListQuery, TICKET_LIST_PARAMS } from "@/lib/ticket-list";
import { PageHeader, PageBody } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { ListToolbar, type FilterDef } from "@/components/list-toolbar";
import { PaginationBar } from "@/components/pagination-bar";
import { EmptyState } from "@/components/empty-state";
import { getEnumT, getT } from "@/lib/i18n/server";
import {
  TICKET_STATUS_META,
  PRIORITY_META,
  TICKET_TYPE_META,
  TICKET_STATUSES,
  PRIORITIES,
  TICKET_TYPES,
} from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("tickets");
  return { title: t("list.title") };
}
export const dynamic = "force-dynamic";

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = getPage(sp);
  const [t, tc, te] = await Promise.all([getT("tickets"), getT("common"), getEnumT()]);
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
        include: { assignee: true, requester: true, group: true, category: true, sla: { select: { businessCalendarId: true } } },
      }),
    ),
  ]);

  const clocks = await activeSlaClocks(tickets);
  const rows = tickets.map((t, i) => ({
    id: t.id,
    prefix: t.prefix,
    title: t.title,
    category: t.category?.name ?? null,
    requesterName: t.requester.name ?? t.requester.email,
    requesterVip: t.requester.isVip,
    priority: t.priority,
    status: t.status,
    sla: slaCell(clocks[i]),
    assignee: t.assignee ? { name: t.assignee.name, email: t.assignee.email } : null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));

  const filters: FilterDef[] = [
    {
      key: "status",
      label: tc("status"),
      options: [
        { value: "open", label: t("list.openActive") },
        ...te.options(TICKET_STATUS_META, TICKET_STATUSES),
      ],
    },
    { key: "priority", label: tc("priority"), options: te.options(PRIORITY_META, PRIORITIES) },
    { key: "type", label: tc("type"), options: te.options(TICKET_TYPE_META, TICKET_TYPES) },
    { key: "group", label: tc("group"), options: opts.groups.map((g) => ({ value: g.id, label: g.name })) },
    {
      key: "assignee",
      label: tc("assignee"),
      options: [
        { value: "unassigned", label: tc("unassigned") },
        ...opts.agents.map((a) => ({ value: a.id, label: a.name ?? a.email })),
      ],
    },
    { key: "sla", label: "SLA", options: SLA_VIEWS.map((v) => ({ value: v, label: t.dyn(`slaView.${v}`, undefined, SLA_VIEW_META[v].label) })) },
    { key: "category", label: tc("category"), options: opts.categories.map((c) => ({ value: c.id, label: c.name })) },
    { key: "service", label: tc("service"), options: opts.services.map((s) => ({ value: s.id, label: s.name })) },
  ];

  return (
    <>
      <PageHeader
        icon={TicketIcon}
        title={t("list.title")}
        description={t("list.description")}
      >
        <LinkButton href="/tickets/new">
          <Plus className="size-4" /> {t("newTicket")}
        </LinkButton>
      </PageHeader>

      <PageBody className="grid gap-4">
        <SavedViewsBar
          entity="ticket"
          basePath="/tickets"
          filterKeys={SAVED_VIEW_KEYS.ticket}
          views={savedViews}
          currentUserId={me?.id ?? ""}
          canManageShared={!!me && hasRole(me.role as Role, "MANAGER")}
          teams={opts.groups.map((g) => ({ value: g.id, label: g.name }))}
        />
        <ListToolbar filters={filters} searchPlaceholder={t("list.searchPlaceholder")}>
          <LinkButton href={exportHref} variant="outline" size="sm">
            <Download className="size-4" /> {tc("exportCsv")}
          </LinkButton>
        </ListToolbar>

        {tickets.length === 0 ? (
          <EmptyState
            icon={TicketIcon}
            title={t("list.emptyTitle")}
            description={t("list.emptyDescription")}
          >
            <LinkButton href="/tickets/new" size="sm">
              <Plus className="size-4" /> {t("newTicket")}
            </LinkButton>
          </EmptyState>
        ) : (
          <TicketsTable
            rows={rows}
            sort={sort}
            dir={dir}
            canBulk={!!me && isAgent(me.role as Role)}
            bulkOptions={{
              agents: opts.agents.map((a) => ({ value: a.id, label: a.name ?? a.email })),
              groups: opts.groups.map((g) => ({ value: g.id, label: g.name })),
              categories: opts.categories.map((c) => ({ value: c.id, label: c.name })),
            }}
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
