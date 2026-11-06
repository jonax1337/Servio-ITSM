import Link from "next/link";
import type { ReactNode } from "react";
import { Building2 } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getPage, getParam, PAGE_SIZE, type SearchParams } from "@/lib/query";
import { ListToolbar, type FilterDef } from "@/components/list-toolbar";
import { SortableHead } from "@/components/sort-header";
import { PaginationBar } from "@/components/pagination-bar";
import { ToneBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const filters: FilterDef[] = [
  {
    key: "state",
    label: "State",
    options: [
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive" },
    ],
  },
];

/** The Vendors tab of /contracts: filterable, sortable, paginated. */
export async function VendorList({ sp, createAction }: { sp: SearchParams; createAction: ReactNode }) {
  const page = getPage(sp);
  const q = getParam(sp, "q");
  const state = getParam(sp, "state");
  const isFiltered = Boolean(q) || (state !== undefined && state !== "all");

  const where: Prisma.VendorWhereInput = {};
  if (q) where.name = { contains: q };
  if (state === "active") where.isActive = true;
  if (state === "inactive") where.isActive = false;

  const sort = getParam(sp, "sort") ?? "name";
  const dir: "asc" | "desc" = getParam(sp, "dir") === "desc" ? "desc" : "asc";
  const orderBy: Prisma.VendorOrderByWithRelationInput = sort === "contracts" ? { contracts: { _count: dir } } : { name: dir };

  const [total, vendors] = await Promise.all([
    db.vendor.count({ where }),
    db.vendor.findMany({
      where,
      include: { _count: { select: { contracts: true, licenses: true } } },
      orderBy: [orderBy],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  return (
    <div className="grid gap-4">
      <ListToolbar filters={filters} searchPlaceholder="Search vendors…" />

      {vendors.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={isFiltered ? "No vendors match" : "No vendors yet"}
          description={
            isFiltered
              ? "Try adjusting your search or filters."
              : "Add the suppliers you hold contracts and licenses with."
          }
        >
          {isFiltered ? null : createAction}
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortableHead k="name" label="Vendor" sort={sort} dir={dir} />
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <SortableHead k="contracts" label="Contracts" sort={sort} dir={dir} numeric />
                <TableHead>Licenses</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors.map((v) => (
                <TableRow key={v.id} className="group">
                  <TableCell className="max-w-[320px]">
                    <Link href={`/contracts/vendors/${v.id}`} className="line-clamp-1 font-medium group-hover:text-primary">
                      {v.name}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{v.email ?? v.phone ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{v._count.contracts}</TableCell>
                  <TableCell className="tabular-nums">{v._count.licenses}</TableCell>
                  <TableCell>
                    <ToneBadge meta={v.isActive ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" }} dot />
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
