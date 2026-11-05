import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { requireUser } from "@/lib/session";
import { refSearchWhere } from "@/lib/ref-search";
import { getParam, getPage, PAGE_SIZE, type SearchParams } from "@/lib/query";
import { PageHeader, PageBody } from "@/components/page-header";
import { CreateProblemDialog } from "@/components/problems/create-problem-dialog";
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
  PROBLEM_STATUS_META,
  PRIORITY_META,
  PROBLEM_STATUSES,
  PRIORITIES,
  problemRef,
} from "@/lib/constants";
import { formatDistanceToNow } from "date-fns";

export const metadata: Metadata = { title: "Problems" };
export const dynamic = "force-dynamic";

export default async function ProblemsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const [me, options] = await Promise.all([requireUser(), getFormOptions()]);
  const page = getPage(sp);
  const q = getParam(sp, "q");
  const status = getParam(sp, "status");
  const priority = getParam(sp, "priority");

  const where: Prisma.ProblemWhereInput = {};
  if (q) Object.assign(where, refSearchWhere(q, "PRB"));
  if (status && status !== "all") where.status = status;
  if (priority && priority !== "all") where.priority = priority;

  const sort = getParam(sp, "sort") ?? "createdAt";
  const dir: "asc" | "desc" = getParam(sp, "dir") === "asc" ? "asc" : "desc";
  const ORDER: Record<string, Prisma.ProblemOrderByWithRelationInput> = {
    id: { id: dir },
    title: { title: dir },
    status: { status: dir },
    priority: { priority: dir },
    assignee: { assignee: { name: dir } },
    incidents: { tickets: { _count: dir } },
    createdAt: { createdAt: dir },
  };
  const orderBy = ORDER[sort] ?? ORDER.createdAt;

  const [total, problems] = await Promise.all([
    db.problem.count({ where }),
    db.problem.findMany({
      where,
      include: {
        assignee: true,
        category: true,
        _count: { select: { tickets: true } },
      },
      orderBy: [orderBy],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const filters: FilterDef[] = [
    { key: "status", label: "Status", options: PROBLEM_STATUSES.map((s) => ({ value: s, label: PROBLEM_STATUS_META[s].label })) },
    { key: "priority", label: "Priority", options: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label })) },
  ];

  return (
    <>
      <PageHeader
        icon={AlertTriangle}
        title="Problems"
        description="Root-cause analysis for recurring incidents and known errors."
      >
        <CreateProblemDialog options={options} currentUserId={me.id} />
      </PageHeader>

      <PageBody className="grid gap-4">
        <ListToolbar filters={filters} searchPlaceholder="Search problems…" />

        {problems.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title="No problems found"
            description="Try adjusting your filters, or create a new problem record to get started."
          >
            <CreateProblemDialog options={options} currentUserId={me.id} size="sm" />
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead k="id" label="Ref" sort={sort} dir={dir} numeric className="w-[92px]" />
                  <SortableHead k="title" label="Title" sort={sort} dir={dir} />
                  <SortableHead k="status" label="Status" sort={sort} dir={dir} />
                  <TableHead>Priority</TableHead>
                  <SortableHead k="assignee" label="Assignee" sort={sort} dir={dir} className="hidden md:table-cell" />
                  <SortableHead k="incidents" label="Incidents" sort={sort} dir={dir} numeric className="hidden lg:table-cell text-right" />
                  <SortableHead k="createdAt" label="Created" sort={sort} dir={dir} numeric className="hidden xl:table-cell text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {problems.map((p) => (
                  <TableRow key={p.id} className="group">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {problemRef(p.id)}
                    </TableCell>
                    <TableCell className="max-w-[420px]">
                      <Link href={`/problems/${p.id}`} className="block">
                        <span className="line-clamp-1 font-medium group-hover:text-primary">
                          {p.title}
                        </span>
                        {p.category ? (
                          <span className="text-xs text-muted-foreground">{p.category.name}</span>
                        ) : null}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge map={PROBLEM_STATUS_META} value={p.status} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge map={PRIORITY_META} value={p.priority} dot />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {p.assignee ? (
                        <div className="flex items-center gap-2">
                          <UserAvatar
                            name={p.assignee.name}
                            email={p.assignee.email}
                            size="sm"
                          />
                          <span className="text-sm text-muted-foreground">
                            {p.assignee.name?.split(" ")[0] ?? p.assignee.email}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-right text-sm tabular-nums text-muted-foreground">
                      {p._count.tickets}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell text-right text-xs text-muted-foreground">
                      {formatDistanceToNow(p.createdAt, { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <PaginationBar
          pathname="/problems"
          searchParams={sp}
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
        />
      </PageBody>
    </>
  );
}
