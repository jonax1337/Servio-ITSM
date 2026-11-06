import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { Activity, ExternalLink, Plus } from "lucide-react";
import { format } from "date-fns";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { getParam, getPage, PAGE_SIZE, type SearchParams } from "@/lib/query";
import { PageHeader, PageBody } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { ListToolbar, type FilterDef } from "@/components/list-toolbar";
import { SortableHead } from "@/components/sort-header";
import { PaginationBar } from "@/components/pagination-bar";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { ScheduledMaintenance } from "@/components/maintenance/scheduled-maintenance";
import { VisibilityBadge } from "@/components/status/visibility-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  STATUS_INCIDENT_IMPACTS,
  STATUS_INCIDENT_IMPACT_META,
  STATUS_INCIDENT_STATES,
  STATUS_INCIDENT_STATE_META,
  ticketRef,
} from "@/lib/constants";

export const metadata: Metadata = { title: "Status" };
export const dynamic = "force-dynamic";

const VISIBILITY_OPTIONS = [
  { value: "public", label: "Public" },
  { value: "draft", label: "Draft" },
];

export default async function StatusIncidentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireRole("AGENT");
  const sp = await searchParams;
  const page = getPage(sp);
  const q = getParam(sp, "q");
  const state = getParam(sp, "state");
  const impact = getParam(sp, "impact");
  const visibility = getParam(sp, "visibility");

  const where: Prisma.StatusIncidentWhereInput = {};
  if (q) where.title = { contains: q };
  if (state && state !== "all") where.state = state;
  if (impact && impact !== "all") where.impact = impact;
  if (visibility === "public") where.isPublic = true;
  if (visibility === "draft") where.isPublic = false;
  const filtered = Boolean(q) || [state, impact, visibility].some((v) => v && v !== "all");

  const sort = getParam(sp, "sort") ?? "startedAt";
  const dir: "asc" | "desc" = getParam(sp, "dir") === "asc" ? "asc" : "desc";
  const ORDER: Record<string, Prisma.StatusIncidentOrderByWithRelationInput> = {
    title: { title: dir },
    state: { state: dir },
    startedAt: { startedAt: dir },
  };
  const orderBy = ORDER[sort] ?? ORDER.startedAt;

  const [total, incidents] = await Promise.all([
    db.statusIncident.count({ where }),
    db.statusIncident.findMany({
      where,
      orderBy: [orderBy],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        title: true,
        state: true,
        impact: true,
        isPublic: true,
        startedAt: true,
        services: { select: { service: { select: { name: true } } } },
        ticket: { select: { id: true, type: true, prefix: true } },
      },
    }),
  ]);

  const filters: FilterDef[] = [
    { key: "state", label: "State", options: STATUS_INCIDENT_STATES.map((s) => ({ value: s, label: STATUS_INCIDENT_STATE_META[s].label })) },
    { key: "impact", label: "Impact", options: STATUS_INCIDENT_IMPACTS.map((i) => ({ value: i, label: STATUS_INCIDENT_IMPACT_META[i].label })) },
    { key: "visibility", label: "Visibility", options: VISIBILITY_OPTIONS },
  ];

  return (
    <>
      <PageHeader icon={Activity} title="Status" description="Tell portal users what is broken and when it is fixed.">
        <LinkButton href="/portal/status" variant="outline">
          <ExternalLink className="size-4" /> Portal status page
        </LinkButton>
        <LinkButton href="/status/new">
          <Plus className="size-4" /> New incident
        </LinkButton>
      </PageHeader>

      <PageBody className="grid gap-4">
        <ScheduledMaintenance />
        <ListToolbar filters={filters} searchPlaceholder="Search incidents…" />

        {incidents.length === 0 ? (
          <EmptyState
            icon={Activity}
            title={filtered ? "No incidents match" : "No status incidents"}
            description={
              filtered
                ? "Try adjusting your filters."
                : "Declaring a major incident on a ticket drafts one for you, or create one yourself."
            }
          >
            {filtered ? null : (
              <LinkButton href="/status/new" size="sm">
                <Plus className="size-4" /> New incident
              </LinkButton>
            )}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead k="title" label="Incident" sort={sort} dir={dir} />
                  <SortableHead k="state" label="State" sort={sort} dir={dir} />
                  <TableHead>Impact</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead className="hidden lg:table-cell">Services</TableHead>
                  <TableHead className="hidden md:table-cell">Ticket</TableHead>
                  <SortableHead k="startedAt" label="Started" sort={sort} dir={dir} numeric className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((i) => (
                  <TableRow key={i.id} className="group">
                    <TableCell className="max-w-[420px]">
                      <Link href={`/status/${i.id}`} className="line-clamp-1 font-medium group-hover:text-primary">
                        {i.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge map={STATUS_INCIDENT_STATE_META} value={i.state} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge map={STATUS_INCIDENT_IMPACT_META} value={i.impact} dot={false} />
                    </TableCell>
                    <TableCell>
                      <VisibilityBadge isPublic={i.isPublic} />
                    </TableCell>
                    <TableCell className="hidden max-w-48 truncate text-muted-foreground lg:table-cell">
                      {i.services.map((s) => s.service.name).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {i.ticket ? (
                        <Link href={`/tickets/${i.ticket.id}`} className="font-mono text-xs text-muted-foreground hover:text-primary">
                          {ticketRef(i.ticket.id, i.ticket.prefix || i.ticket.type)}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground tabular-nums">
                      {format(i.startedAt, "MMM d, HH:mm")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <PaginationBar pathname="/status" searchParams={sp} page={page} pageSize={PAGE_SIZE} total={total} />
      </PageBody>
    </>
  );
}
