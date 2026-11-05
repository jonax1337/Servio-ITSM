import Link from "next/link";
import { GitPullRequestArrow, Plus } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { refSearchWhere } from "@/lib/ref-search";
import { getParam, getPage, PAGE_SIZE, type SearchParams } from "@/lib/query";
import { PageHeader, PageBody } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { ListToolbar, type FilterDef } from "@/components/list-toolbar";
import { SortableHead } from "@/components/sort-header";
import { PaginationBar } from "@/components/pagination-bar";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CHANGE_STATUS_META,
  CHANGE_TYPE_META,
  RISK_META,
  CHANGE_STATUSES,
  CHANGE_TYPES,
  RISKS,
  changeRef,
} from "@/lib/constants";
import { format } from "date-fns";

export const metadata: Metadata = { title: "Changes" };
export const dynamic = "force-dynamic";

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = getPage(sp);
  const q = getParam(sp, "q");
  const status = getParam(sp, "status");
  const type = getParam(sp, "type");
  const risk = getParam(sp, "risk");

  const where: Prisma.ChangeWhereInput = {};
  if (q) Object.assign(where, refSearchWhere(q, "CHG"));
  if (status && status !== "all") where.status = status;
  if (type && type !== "all") where.type = type;
  if (risk && risk !== "all") where.risk = risk;

  const sort = getParam(sp, "sort") ?? "updatedAt";
  const dir: "asc" | "desc" = getParam(sp, "dir") === "asc" ? "asc" : "desc";
  const ORDER: Record<string, Prisma.ChangeOrderByWithRelationInput> = {
    id: { id: dir },
    title: { title: dir },
    status: { status: dir },
    plannedStart: { plannedStart: dir },
    assignee: { assignee: { name: dir } },
    updatedAt: { updatedAt: dir },
  };
  const orderBy = ORDER[sort] ?? ORDER.updatedAt;

  const [total, changes] = await Promise.all([
    db.change.count({ where }),
    db.change.findMany({
      where,
      include: { assignee: true, category: true },
      orderBy: [orderBy],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const filters: FilterDef[] = [
    {
      key: "status",
      label: "Status",
      options: CHANGE_STATUSES.map((s) => ({ value: s, label: CHANGE_STATUS_META[s].label })),
    },
    {
      key: "type",
      label: "Type",
      options: CHANGE_TYPES.map((t) => ({ value: t, label: CHANGE_TYPE_META[t].label })),
    },
    {
      key: "risk",
      label: "Risk",
      options: RISKS.map((r) => ({ value: r, label: RISK_META[r].label })),
    },
  ];

  return (
    <>
      <PageHeader
        icon={GitPullRequestArrow}
        title="Changes"
        description="Standard, normal and emergency changes moving through approval."
      >
        <LinkButton href="/changes/new">
          <Plus className="size-4" /> New change
        </LinkButton>
      </PageHeader>

      <PageBody className="grid gap-4">
        <ListToolbar filters={filters} searchPlaceholder="Search changes…" />

        {changes.length === 0 ? (
          <EmptyState
            icon={GitPullRequestArrow}
            title="No changes found"
            description="Try adjusting your filters, or raise a new change to get started."
          >
            <LinkButton href="/changes/new" size="sm">
              <Plus className="size-4" /> New change
            </LinkButton>
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead k="id" label="Ref" sort={sort} dir={dir} numeric className="w-[96px]" />
                  <SortableHead k="title" label="Title" sort={sort} dir={dir} />
                  <TableHead>Type</TableHead>
                  <SortableHead k="status" label="Status" sort={sort} dir={dir} />
                  <TableHead>Risk</TableHead>
                  <SortableHead k="plannedStart" label="Planned start" sort={sort} dir={dir} numeric className="hidden lg:table-cell text-right" />
                  <SortableHead k="assignee" label="Assignee" sort={sort} dir={dir} className="hidden md:table-cell" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.map((c) => (
                  <TableRow key={c.id} className="group">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {changeRef(c.id)}
                    </TableCell>
                    <TableCell className="max-w-[420px]">
                      <Link href={`/changes/${c.id}`} className="block">
                        <span className="line-clamp-1 font-medium group-hover:text-primary">
                          {c.title}
                        </span>
                        {c.category ? (
                          <span className="text-xs text-muted-foreground">{c.category.name}</span>
                        ) : null}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge map={CHANGE_TYPE_META} value={c.type} dot />
                    </TableCell>
                    <TableCell>
                      <StatusBadge map={CHANGE_STATUS_META} value={c.status} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge map={RISK_META} value={c.risk} dot />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-right text-xs text-muted-foreground tabular-nums">
                      {c.plannedStart ? format(c.plannedStart, "PP") : "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {c.assignee ? (
                        <div className="flex items-center gap-2">
                          <UserAvatar
                            name={c.assignee.name}
                            email={c.assignee.email}
                            size="sm"
                          />
                          <span className="text-sm text-muted-foreground">
                            {c.assignee.name?.split(" ")[0] ?? c.assignee.email}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <PaginationBar
          pathname="/changes"
          searchParams={sp}
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
        />
      </PageBody>
    </>
  );
}
