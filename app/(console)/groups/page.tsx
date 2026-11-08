import Link from "next/link";
import { Users, Mail } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { getParam, getPage, PAGE_SIZE, type SearchParams } from "@/lib/query";
import { PageHeader, PageBody } from "@/components/page-header";
import { CreateGroupDialog } from "@/components/groups/create-group-dialog";
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
import { GROUP_TYPE_META, GROUP_TYPES } from "@/lib/constants";
import { getEnumT, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("groups");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const [t, te] = await Promise.all([getT("groups"), getEnumT()]);
  const page = getPage(sp);
  const q = getParam(sp, "q");
  const type = getParam(sp, "type");

  const where: Prisma.GroupWhereInput = {};
  if (q) where.name = { contains: q };
  if (type && type !== "all") where.type = type;

  const sort = getParam(sp, "sort") ?? "name";
  const dir: "asc" | "desc" = getParam(sp, "dir") === "desc" ? "desc" : "asc";
  const ORDER: Record<string, Prisma.GroupOrderByWithRelationInput> = {
    name: { name: dir },
    manager: { manager: { name: dir } },
    email: { email: dir },
    members: { members: { _count: dir } },
  };
  const orderBy = ORDER[sort] ?? ORDER.name;

  const [total, groups, options] = await Promise.all([
    db.group.count({ where }),
    db.group.findMany({
      where,
      include: { manager: true, _count: { select: { members: true } } },
      orderBy: [orderBy],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    getFormOptions(),
  ]);

  const filters: FilterDef[] = [
    {
      key: "type",
      label: t("filterType"),
      options: te.options(GROUP_TYPE_META, GROUP_TYPES),
    },
  ];

  return (
    <>
      <PageHeader
        icon={Users}
        title={t("title")}
        description={t("description")}
      >
        <CreateGroupDialog options={options} />
      </PageHeader>

      <PageBody className="grid gap-4">
        <ListToolbar filters={filters} searchPlaceholder={t("searchPlaceholder")} />

        {groups.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t("noneFound")}
            description={t("noneFoundText")}
          >
            <CreateGroupDialog options={options} size="sm" />
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead k="name" label={t("colName")} sort={sort} dir={dir} />
                  <TableHead>{t("colType")}</TableHead>
                  <SortableHead k="manager" label={t("colManager")} sort={sort} dir={dir} className="hidden md:table-cell" />
                  <SortableHead k="email" label={t("colEmail")} sort={sort} dir={dir} className="hidden lg:table-cell" />
                  <SortableHead k="members" label={t("colMembers")} sort={sort} dir={dir} numeric className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <TableRow key={g.id} className="group">
                    <TableCell className="max-w-[360px]">
                      <Link href={`/groups/${g.id}`} className="flex items-center gap-2.5">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: g.color }}
                        />
                        <span className="min-w-0">
                          <span className="line-clamp-1 font-medium group-hover:text-primary">
                            {g.name}
                          </span>
                          {g.description ? (
                            <span className="line-clamp-1 text-xs text-muted-foreground">
                              {g.description}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge map={GROUP_TYPE_META} value={g.type} dot />
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {g.manager ? (g.manager.name ?? g.manager.email) : "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {g.email ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Mail className="size-3.5" /> {g.email}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {g._count.members}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <PaginationBar
          pathname="/groups"
          searchParams={sp}
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
        />
      </PageBody>
    </>
  );
}
