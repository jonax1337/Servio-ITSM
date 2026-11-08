import Link from "next/link";
import type { ReactNode } from "react";
import { FileSignature } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getPage, getParam, PAGE_SIZE, type SearchParams } from "@/lib/query";
import {
  CONTRACT_STATUSES, CONTRACT_STATUS_META, CONTRACT_TYPES, CONTRACT_TYPE_META,
} from "@/lib/constants";
import { getEnumT, getT } from "@/lib/i18n/server";
import { formatCostIn, formatDayIn } from "./contract-format";
import { ListToolbar, type FilterDef } from "@/components/list-toolbar";
import { SortableHead } from "@/components/sort-header";
import { PaginationBar } from "@/components/pagination-bar";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContractExpiryBadge } from "./contract-badges";

/** The Contracts tab of /contracts: filterable, sortable, paginated. */
export async function ContractList({ sp, createAction }: { sp: SearchParams; createAction: ReactNode }) {
  const now = new Date();
  const [t, tc, te] = await Promise.all([getT("contracts"), getT("common"), getEnumT()]);
  const filters: FilterDef[] = [
    { key: "status", label: tc("status"), options: te.options(CONTRACT_STATUS_META, CONTRACT_STATUSES) },
    { key: "type", label: tc("type"), options: te.options(CONTRACT_TYPE_META, CONTRACT_TYPES) },
  ];
  const page = getPage(sp);
  const q = getParam(sp, "q");
  const status = getParam(sp, "status");
  const type = getParam(sp, "type");
  const isFiltered = Boolean(q) || (status !== undefined && status !== "all") || (type !== undefined && type !== "all");

  const where: Prisma.ContractWhereInput = {};
  if (q) where.OR = [{ name: { contains: q } }, { number: { contains: q } }];
  if (status && status !== "all") where.status = status;
  if (type && type !== "all") where.type = type;

  const sort = getParam(sp, "sort") ?? "endDate";
  const dir: "asc" | "desc" = getParam(sp, "dir") === "desc" ? "desc" : "asc";
  const ORDER: Record<string, Prisma.ContractOrderByWithRelationInput> = {
    name: { name: dir },
    vendor: { vendor: { name: dir } },
    status: { status: dir },
    endDate: { endDate: dir },
    cost: { cost: dir },
  };

  const [total, contracts] = await Promise.all([
    db.contract.count({ where }),
    db.contract.findMany({
      where,
      include: { vendor: { select: { name: true } }, owner: { select: { name: true, email: true } } },
      orderBy: [ORDER[sort] ?? ORDER.endDate],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  return (
    <div className="grid gap-4">
      <ListToolbar filters={filters} searchPlaceholder={t("searchContracts")} />

      {contracts.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title={isFiltered ? t("contracts.noMatch") : t("contracts.none")}
          description={isFiltered ? t("adjustFilters") : t("contracts.noneHint")}
        >
          {isFiltered ? null : createAction}
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortableHead k="name" label={t("col.contract")} sort={sort} dir={dir} />
                <SortableHead k="vendor" label={t("col.vendor")} sort={sort} dir={dir} className="hidden md:table-cell" />
                <TableHead>{tc("type")}</TableHead>
                <SortableHead k="status" label={tc("status")} sort={sort} dir={dir} />
                <SortableHead k="endDate" label={t("col.ends")} sort={sort} dir={dir} />
                <TableHead className="hidden lg:table-cell">{tc("owner")}</TableHead>
                <SortableHead k="cost" label={t("col.cost")} sort={sort} dir={dir} numeric className="hidden xl:table-cell" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.map((c) => (
                <TableRow key={c.id} className="group">
                  <TableCell className="max-w-[320px]">
                    <Link href={`/contracts/${c.id}`} className="block">
                      <span className="line-clamp-1 font-medium group-hover:text-primary">{c.name}</span>
                      {c.number ? <span className="font-mono text-xs text-muted-foreground">{c.number}</span> : null}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{c.vendor?.name ?? "—"}</TableCell>
                  <TableCell><StatusBadge map={CONTRACT_TYPE_META} value={c.type} dot={false} /></TableCell>
                  <TableCell><StatusBadge map={CONTRACT_STATUS_META} value={c.status} /></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm tabular-nums">{c.endDate ? formatDayIn(t.locale, c.endDate) : t("noEndDate")}</span>
                      <ContractExpiryBadge contract={c} now={now} />
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {c.owner ? (c.owner.name ?? c.owner.email) : "—"}
                  </TableCell>
                  <TableCell className="hidden text-sm tabular-nums text-muted-foreground xl:table-cell">
                    {c.cost != null ? formatCostIn(t.locale, c.cost) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <PaginationBar pathname="/contracts" searchParams={sp} page={page} pageSize={PAGE_SIZE} total={total} />
    </div>
  );
}
