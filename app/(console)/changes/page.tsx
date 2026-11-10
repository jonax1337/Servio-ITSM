import Link from "next/link";
import { CalendarRange, FileStack, GitPullRequestArrow, Plus } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { refSearchWhere } from "@/lib/ref-search";
import { hasRole, requireUser } from "@/lib/session";
import { PAGE_SIZE, type SearchParams, type SortDir, getPage, getParam, listSort } from "@/lib/query";
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
import { getEnumT, getFormatter, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("changes");
  return { title: t("list.title") };
}
export const dynamic = "force-dynamic";

const SORT_KEYS = ["id", "title", "status", "plannedStart", "assignee", "updatedAt"] as const;
type SortKey = (typeof SORT_KEYS)[number];
const DEFAULT_SORT: { sort: SortKey; dir: SortDir } = { sort: "id", dir: "desc" };

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const me = await requireUser();
  const [t, tc, te, f] = await Promise.all([getT("changes"), getT("common"), getEnumT(), getFormatter()]);
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

  const { sort, dir } = listSort(sp, SORT_KEYS, DEFAULT_SORT);
  const ORDER: Record<SortKey, Prisma.ChangeOrderByWithRelationInput> = {
    id: { id: dir },
    title: { title: dir },
    status: { status: dir },
    plannedStart: { plannedStart: dir },
    assignee: { assignee: { name: dir } },
    updatedAt: { updatedAt: dir },
  };
  // Ties fall back to the id, so equal values keep a stable order across pages.
  const orderBy = sort === "id" ? [ORDER.id] : [ORDER[sort], { id: "desc" as const }];

  const [total, changes] = await Promise.all([
    db.change.count({ where }),
    db.change.findMany({
      where,
      include: { assignee: true, category: true },
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const filters: FilterDef[] = [
    {
      key: "status",
      label: tc("status"),
      options: te.options(CHANGE_STATUS_META, CHANGE_STATUSES),
    },
    {
      key: "type",
      label: tc("type"),
      options: te.options(CHANGE_TYPE_META, CHANGE_TYPES),
    },
    {
      key: "risk",
      label: tc("risk"),
      options: te.options(RISK_META, RISKS),
    },
  ];

  return (
    <>
      <PageHeader
        icon={GitPullRequestArrow}
        title={t("list.title")}
        description={t("list.description")}
      >
        <LinkButton href="/changes/calendar" variant="outline">
          <CalendarRange className="size-4" /> {t("list.calendar")}
        </LinkButton>
        {hasRole(me.role, "MANAGER") ? (
          <LinkButton href="/changes/templates" variant="outline">
            <FileStack className="size-4" /> {t("list.templates")}
          </LinkButton>
        ) : null}
        <LinkButton href="/changes/new">
          <Plus className="size-4" /> {t("list.newChange")}
        </LinkButton>
      </PageHeader>

      <PageBody className="grid gap-4">
        <ListToolbar filters={filters} searchPlaceholder={t("list.searchPlaceholder")} />

        {changes.length === 0 ? (
          <EmptyState
            icon={GitPullRequestArrow}
            title={t("list.emptyTitle")}
            description={t("list.emptyDescription")}
          >
            <LinkButton href="/changes/new" size="sm">
              <Plus className="size-4" /> {t("list.newChange")}
            </LinkButton>
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead k="id" label={t("list.ref")} sort={sort} dir={dir} numeric className="w-[96px]" />
                  <SortableHead k="title" label={tc("title")} sort={sort} dir={dir} />
                  <TableHead>{tc("type")}</TableHead>
                  <SortableHead k="status" label={tc("status")} sort={sort} dir={dir} />
                  <TableHead>{tc("risk")}</TableHead>
                  <SortableHead k="plannedStart" label={t("list.plannedStart")} sort={sort} dir={dir} numeric className="hidden lg:table-cell text-right" />
                  <SortableHead k="assignee" label={tc("assignee")} sort={sort} dir={dir} className="hidden md:table-cell" />
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
                      {f.date(c.plannedStart)}
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
