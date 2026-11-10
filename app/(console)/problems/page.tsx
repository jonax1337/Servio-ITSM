import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { requireUser } from "@/lib/session";
import { refSearchWhere } from "@/lib/ref-search";
import { PAGE_SIZE, type SearchParams, type SortDir, getPage, getParam, listSort } from "@/lib/query";
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
import { getEnumT, getFormatter, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("problems");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

const SORT_KEYS = ["id", "title", "status", "priority", "assignee", "incidents", "createdAt"] as const;
type SortKey = (typeof SORT_KEYS)[number];
const DEFAULT_SORT: { sort: SortKey; dir: SortDir } = { sort: "id", dir: "desc" };

export default async function ProblemsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const [me, options, t, tc, te, f] = await Promise.all([
    requireUser(),
    getFormOptions(),
    getT("problems"),
    getT("common"),
    getEnumT(),
    getFormatter(),
  ]);
  const page = getPage(sp);
  const q = getParam(sp, "q");
  const status = getParam(sp, "status");
  const priority = getParam(sp, "priority");

  const where: Prisma.ProblemWhereInput = {};
  if (q) Object.assign(where, refSearchWhere(q, "PRB"));
  if (status && status !== "all") where.status = status;
  if (priority && priority !== "all") where.priority = priority;

  const { sort, dir } = listSort(sp, SORT_KEYS, DEFAULT_SORT);
  const ORDER: Record<SortKey, Prisma.ProblemOrderByWithRelationInput> = {
    id: { id: dir },
    title: { title: dir },
    status: { status: dir },
    priority: { priority: dir },
    assignee: { assignee: { name: dir } },
    incidents: { tickets: { _count: dir } },
    createdAt: { createdAt: dir },
  };
  // Ties fall back to the id, so equal values keep a stable order across pages.
  const orderBy = sort === "id" ? [ORDER.id] : [ORDER[sort], { id: "desc" as const }];

  const [total, problems] = await Promise.all([
    db.problem.count({ where }),
    db.problem.findMany({
      where,
      include: {
        assignee: true,
        category: true,
        _count: { select: { tickets: true } },
      },
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const filters: FilterDef[] = [
    { key: "status", label: tc("status"), options: te.options(PROBLEM_STATUS_META, PROBLEM_STATUSES) },
    { key: "priority", label: tc("priority"), options: te.options(PRIORITY_META, PRIORITIES) },
  ];

  return (
    <>
      <PageHeader
        icon={AlertTriangle}
        title={t("title")}
        description={t("description")}
      >
        <CreateProblemDialog options={options} currentUserId={me.id} />
      </PageHeader>

      <PageBody className="grid gap-4">
        <ListToolbar filters={filters} searchPlaceholder={t("searchPlaceholder")} />

        {problems.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          >
            <CreateProblemDialog options={options} currentUserId={me.id} size="sm" />
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead k="id" label={t("col.ref")} sort={sort} dir={dir} numeric className="w-[92px]" />
                  <SortableHead k="title" label={tc("title")} sort={sort} dir={dir} />
                  <SortableHead k="status" label={tc("status")} sort={sort} dir={dir} />
                  <TableHead>{tc("priority")}</TableHead>
                  <SortableHead k="assignee" label={tc("assignee")} sort={sort} dir={dir} className="hidden md:table-cell" />
                  <SortableHead k="incidents" label={t("col.incidents")} sort={sort} dir={dir} numeric className="hidden lg:table-cell text-right" />
                  <SortableHead k="createdAt" label={tc("created")} sort={sort} dir={dir} numeric className="hidden xl:table-cell text-right" />
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
                      {f.relative(p.createdAt)}
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
