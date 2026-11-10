import Link from "next/link";
import { Plus, Rocket } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PAGE_SIZE, type SearchParams, type SortDir, getPage, getParam, listSort } from "@/lib/query";
import { PageHeader, PageBody } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { ListToolbar, type FilterDef } from "@/components/list-toolbar";
import { SortableHead } from "@/components/sort-header";
import { PaginationBar } from "@/components/pagination-bar";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RELEASE_STATUSES, RELEASE_STATUS_META, releaseRef } from "@/lib/constants";
import { releaseReadiness, releaseSearchId, releaseWindow } from "@/lib/release-rules";
import { getEnumT, getFormatter, getT } from "@/lib/i18n/server";
import type { Formatter } from "@/lib/i18n/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("releases");
  return { title: t("list.title") };
}
export const dynamic = "force-dynamic";


function windowLabel({ start, end }: { start: Date | null; end: Date | null }, f: Formatter) {
  if (!start && !end) return "—";
  const fmt = (d: Date | null) => (d ? f.date(d) : "…");
  return `${fmt(start)} – ${fmt(end)}`;
}

const SORT_KEYS = ["id", "name", "status", "owner", "updatedAt"] as const;
type SortKey = (typeof SORT_KEYS)[number];
const DEFAULT_SORT: { sort: SortKey; dir: SortDir } = { sort: "id", dir: "desc" };

export default async function ReleasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const [t, tc, te, f] = await Promise.all([getT("releases"), getT("common"), getEnumT(), getFormatter()]);
  const page = getPage(sp);
  const q = getParam(sp, "q")?.trim();
  const status = getParam(sp, "status");

  const where: Prisma.ReleaseWhereInput = {};
  if (q) {
    const id = releaseSearchId(q);
    where.OR = id ? [{ name: { contains: q } }, { id }] : [{ name: { contains: q } }];
  }
  if (status && status !== "all") where.status = status;

  const { sort, dir } = listSort(sp, SORT_KEYS, DEFAULT_SORT);
  const ORDER: Record<SortKey, Prisma.ReleaseOrderByWithRelationInput> = {
    id: { id: dir },
    name: { name: dir },
    status: { status: dir },
    owner: { owner: { name: dir } },
    updatedAt: { updatedAt: dir },
  };
  // Ties fall back to the id, so equal values keep a stable order across pages.
  const orderBy = sort === "id" ? [ORDER.id] : [ORDER[sort], { id: "desc" as const }];

  const [total, releases] = await Promise.all([
    db.release.count({ where }),
    db.release.findMany({
      where,
      include: {
        owner: true,
        changes: { select: { id: true, status: true, plannedStart: true, plannedEnd: true } },
      },
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const filters: FilterDef[] = [
    {
      key: "status",
      label: tc("status"),
      options: te.options(RELEASE_STATUS_META, RELEASE_STATUSES),
    },
  ];

  return (
    <>
      <PageHeader icon={Rocket} title={t("list.title")} description={t("list.description")}>
        <LinkButton href="/releases/new">
          <Plus className="size-4" /> {t("list.new")}
        </LinkButton>
      </PageHeader>

      <PageBody className="grid gap-4">
        <ListToolbar filters={filters} searchPlaceholder={t("list.search")} />

        {releases.length === 0 ? (
          <EmptyState
            icon={Rocket}
            title={t("list.emptyTitle")}
            description={t("list.emptyDescription")}
          >
            <LinkButton href="/releases/new" size="sm">
              <Plus className="size-4" /> {t("list.new")}
            </LinkButton>
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead k="id" label={t("list.ref")} sort={sort} dir={dir} numeric className="w-[96px]" />
                  <SortableHead k="name" label={tc("name")} sort={sort} dir={dir} />
                  <SortableHead k="status" label={tc("status")} sort={sort} dir={dir} />
                  <TableHead className="hidden md:table-cell">{t("list.changes")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("list.window")}</TableHead>
                  <SortableHead k="owner" label={tc("owner")} sort={sort} dir={dir} className="hidden md:table-cell" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {releases.map((release) => {
                  const readiness = releaseReadiness(release.changes);
                  return (
                    <TableRow key={release.id} className="group">
                      <TableCell className="font-mono text-xs text-muted-foreground">{releaseRef(release.id)}</TableCell>
                      <TableCell className="max-w-[420px]">
                        <Link href={`/releases/${release.id}`} className="line-clamp-1 font-medium group-hover:text-primary">
                          {release.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge map={RELEASE_STATUS_META} value={release.status} />
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {readiness.active === 0 ? "—" : t("list.approvedOf", { approved: readiness.approved, active: readiness.active })}
                      </TableCell>
                      <TableCell className="hidden text-xs tabular-nums text-muted-foreground lg:table-cell">
                        {windowLabel(releaseWindow(release.changes), f)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {release.owner ? (
                          <div className="flex items-center gap-2">
                            <UserAvatar name={release.owner.name} email={release.owner.email} size="sm" />
                            <span className="text-sm text-muted-foreground">
                              {release.owner.name?.split(" ")[0] ?? release.owner.email}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <PaginationBar pathname="/releases" searchParams={sp} page={page} pageSize={PAGE_SIZE} total={total} />
      </PageBody>
    </>
  );
}
