import Link from "next/link";
import { Plus, Rocket } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { format } from "date-fns";
import { db } from "@/lib/db";
import { getParam, getPage, PAGE_SIZE, type SearchParams } from "@/lib/query";
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

export const metadata: Metadata = { title: "Releases" };
export const dynamic = "force-dynamic";

const DEFAULT_SORT = "updatedAt";

function windowLabel({ start, end }: { start: Date | null; end: Date | null }) {
  if (!start && !end) return "—";
  const fmt = (d: Date | null) => (d ? format(d, "PP") : "…");
  return `${fmt(start)} – ${fmt(end)}`;
}

export default async function ReleasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const page = getPage(sp);
  const q = getParam(sp, "q")?.trim();
  const status = getParam(sp, "status");

  const where: Prisma.ReleaseWhereInput = {};
  if (q) {
    const id = releaseSearchId(q);
    where.OR = id ? [{ name: { contains: q } }, { id }] : [{ name: { contains: q } }];
  }
  if (status && status !== "all") where.status = status;

  const sort = getParam(sp, "sort") ?? DEFAULT_SORT;
  const dir: "asc" | "desc" = getParam(sp, "dir") === "asc" ? "asc" : "desc";
  const ORDER: Record<string, Prisma.ReleaseOrderByWithRelationInput> = {
    id: { id: dir },
    name: { name: dir },
    status: { status: dir },
    owner: { owner: { name: dir } },
    updatedAt: { updatedAt: dir },
  };

  const [total, releases] = await Promise.all([
    db.release.count({ where }),
    db.release.findMany({
      where,
      include: {
        owner: true,
        changes: { select: { id: true, status: true, plannedStart: true, plannedEnd: true } },
      },
      orderBy: [ORDER[sort] ?? ORDER[DEFAULT_SORT]],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const filters: FilterDef[] = [
    {
      key: "status",
      label: "Status",
      options: RELEASE_STATUSES.map((s) => ({ value: s, label: RELEASE_STATUS_META[s].label })),
    },
  ];

  return (
    <>
      <PageHeader icon={Rocket} title="Releases" description="Bundles of changes that ship together.">
        <LinkButton href="/releases/new">
          <Plus className="size-4" /> New release
        </LinkButton>
      </PageHeader>

      <PageBody className="grid gap-4">
        <ListToolbar filters={filters} searchPlaceholder="Search releases…" />

        {releases.length === 0 ? (
          <EmptyState
            icon={Rocket}
            title="No releases found"
            description="Try adjusting your filters, or create a release to bundle changes that ship together."
          >
            <LinkButton href="/releases/new" size="sm">
              <Plus className="size-4" /> New release
            </LinkButton>
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead k="id" label="Ref" sort={sort} dir={dir} numeric className="w-[96px]" />
                  <SortableHead k="name" label="Name" sort={sort} dir={dir} />
                  <SortableHead k="status" label="Status" sort={sort} dir={dir} />
                  <TableHead className="hidden md:table-cell">Changes</TableHead>
                  <TableHead className="hidden lg:table-cell">Window</TableHead>
                  <SortableHead k="owner" label="Owner" sort={sort} dir={dir} className="hidden md:table-cell" />
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
                        {readiness.active === 0 ? "—" : `${readiness.approved}/${readiness.active} approved`}
                      </TableCell>
                      <TableCell className="hidden text-xs tabular-nums text-muted-foreground lg:table-cell">
                        {windowLabel(releaseWindow(release.changes))}
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
