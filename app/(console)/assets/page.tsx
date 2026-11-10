import Link from "next/link";
import { HardDrive, Plus } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ASSET_TYPE_META,
  ASSET_STATUS_META,
  ASSET_TYPES,
  ASSET_STATUSES,
} from "@/lib/constants";
import { getEnumT, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("assets");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

const SORT_KEYS = ["name", "status", "owner", "location", "ipAddress", "updatedAt"] as const;
type SortKey = (typeof SORT_KEYS)[number];
const DEFAULT_SORT: { sort: SortKey; dir: SortDir } = { sort: "name", dir: "asc" };

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const [t, tc, te] = await Promise.all([getT("assets"), getT("common"), getEnumT()]);
  const page = getPage(sp);
  const q = getParam(sp, "q");
  const type = getParam(sp, "type");
  const status = getParam(sp, "status");

  const where: Prisma.AssetWhereInput = {};
  if (q)
    where.OR = [
      { name: { contains: q } },
      { assetTag: { contains: q } },
      { serial: { contains: q } },
    ];
  if (type && type !== "all") where.type = type;
  if (status && status !== "all") where.status = status;

  const { sort, dir } = listSort(sp, SORT_KEYS, DEFAULT_SORT);
  const ORDER: Record<SortKey, Prisma.AssetOrderByWithRelationInput> = {
    name: { name: dir },
    status: { status: dir },
    owner: { owner: { name: dir } },
    location: { location: dir },
    ipAddress: { ipAddress: dir },
    updatedAt: { updatedAt: dir },
  };
  // Ties fall back to the id, so equal values keep a stable order across pages.
  const orderBy = [ORDER[sort], { id: "desc" as const }];

  const [total, assets] = await Promise.all([
    db.asset.count({ where }),
    db.asset.findMany({
      where,
      include: { owner: true },
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const filters: FilterDef[] = [
    { key: "type", label: tc("type"), options: te.options(ASSET_TYPE_META, ASSET_TYPES) },
    { key: "status", label: tc("status"), options: te.options(ASSET_STATUS_META, ASSET_STATUSES) },
  ];

  return (
    <>
      <PageHeader
        icon={HardDrive}
        title={t("title")}
        description={t("description")}
      >
        <LinkButton href="/assets/new">
          <Plus className="size-4" /> {t("new.title")}
        </LinkButton>
      </PageHeader>

      <PageBody className="grid gap-4">
        <ListToolbar filters={filters} searchPlaceholder={t("searchPlaceholder")} />

        {assets.length === 0 ? (
          <EmptyState
            icon={HardDrive}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          >
            <LinkButton href="/assets/new" size="sm">
              <Plus className="size-4" /> {t("new.title")}
            </LinkButton>
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead k="name" label={tc("name")} sort={sort} dir={dir} />
                  <TableHead>{tc("type")}</TableHead>
                  <SortableHead k="status" label={tc("status")} sort={sort} dir={dir} />
                  <SortableHead k="owner" label={tc("owner")} sort={sort} dir={dir} className="hidden md:table-cell" />
                  <SortableHead k="location" label={tc("location")} sort={sort} dir={dir} className="hidden lg:table-cell" />
                  <SortableHead k="ipAddress" label={t("field.ipAddress")} sort={sort} dir={dir} className="hidden xl:table-cell" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((a) => (
                  <TableRow key={a.id} className="group">
                    <TableCell className="max-w-[360px]">
                      <Link href={`/assets/${a.id}`} className="block">
                        <span className="line-clamp-1 font-medium group-hover:text-primary">
                          {a.name}
                        </span>
                        {a.assetTag ? (
                          <span className="font-mono text-xs text-muted-foreground">
                            {a.assetTag}
                          </span>
                        ) : null}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge map={ASSET_TYPE_META} value={a.type} dot />
                    </TableCell>
                    <TableCell>
                      <StatusBadge map={ASSET_STATUS_META} value={a.status} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {a.owner ? a.owner.name ?? a.owner.email : "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {a.location ?? "—"}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell font-mono text-xs text-muted-foreground">
                      {a.ipAddress ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <PaginationBar
          pathname="/assets"
          searchParams={sp}
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
        />
      </PageBody>
    </>
  );
}
