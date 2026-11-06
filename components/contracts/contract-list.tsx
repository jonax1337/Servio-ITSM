import Link from "next/link";
import type { ReactNode } from "react";
import { FileSignature } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getPage, getParam, PAGE_SIZE, type SearchParams } from "@/lib/query";
import {
  CONTRACT_STATUSES, CONTRACT_STATUS_META, CONTRACT_TYPES, CONTRACT_TYPE_META,
} from "@/lib/constants";
import { formatCost, formatDay } from "@/lib/contract-rules";
import { ListToolbar, type FilterDef } from "@/components/list-toolbar";
import { SortableHead } from "@/components/sort-header";
import { PaginationBar } from "@/components/pagination-bar";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContractExpiryBadge } from "./contract-badges";

const filters: FilterDef[] = [
  { key: "status", label: "Status", options: CONTRACT_STATUSES.map((s) => ({ value: s, label: CONTRACT_STATUS_META[s].label })) },
  { key: "type", label: "Type", options: CONTRACT_TYPES.map((t) => ({ value: t, label: CONTRACT_TYPE_META[t].label })) },
];

/** The Contracts tab of /contracts: filterable, sortable, paginated. */
export async function ContractList({ sp, createAction }: { sp: SearchParams; createAction: ReactNode }) {
  const now = new Date();
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
      <ListToolbar filters={filters} searchPlaceholder="Search contracts…" />

      {contracts.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title={isFiltered ? "No contracts match" : "No contracts yet"}
          description={
            isFiltered
              ? "Try adjusting your search or filters."
              : "Add a vendor agreement to track its term and get reminded before it ends."
          }
        >
          {isFiltered ? null : createAction}
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortableHead k="name" label="Contract" sort={sort} dir={dir} />
                <SortableHead k="vendor" label="Vendor" sort={sort} dir={dir} className="hidden md:table-cell" />
                <TableHead>Type</TableHead>
                <SortableHead k="status" label="Status" sort={sort} dir={dir} />
                <SortableHead k="endDate" label="Ends" sort={sort} dir={dir} />
                <TableHead className="hidden lg:table-cell">Owner</TableHead>
                <SortableHead k="cost" label="Cost" sort={sort} dir={dir} numeric className="hidden xl:table-cell" />
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
                      <span className="text-sm tabular-nums">{c.endDate ? formatDay(c.endDate) : "No end date"}</span>
                      <ContractExpiryBadge contract={c} now={now} />
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {c.owner ? (c.owner.name ?? c.owner.email) : "—"}
                  </TableCell>
                  <TableCell className="hidden text-sm tabular-nums text-muted-foreground xl:table-cell">
                    {c.cost != null ? formatCost(c.cost) : "—"}
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
