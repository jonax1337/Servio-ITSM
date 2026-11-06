import Link from "next/link";
import type { ReactNode } from "react";
import { KeyRound } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getPage, getParam, PAGE_SIZE, type SearchParams } from "@/lib/query";
import { LICENSE_TYPES, LICENSE_TYPE_META } from "@/lib/constants";
import { formatDay, licenseCompliance } from "@/lib/contract-rules";
import { ListToolbar, type FilterDef } from "@/components/list-toolbar";
import { SortableHead } from "@/components/sort-header";
import { PaginationBar } from "@/components/pagination-bar";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LicenseComplianceBadge, LicenseExpiryBadge } from "./contract-badges";

const filters: FilterDef[] = [
  { key: "type", label: "Type", options: LICENSE_TYPES.map((t) => ({ value: t, label: LICENSE_TYPE_META[t].label })) },
];

/** The Licenses tab of /contracts: filterable, sortable, paginated, with seat compliance per license. */
export async function LicenseList({ sp, createAction }: { sp: SearchParams; createAction: ReactNode }) {
  const now = new Date();
  const page = getPage(sp);
  const q = getParam(sp, "q");
  const type = getParam(sp, "type");
  const isFiltered = Boolean(q) || (type !== undefined && type !== "all");

  const where: Prisma.SoftwareLicenseWhereInput = {};
  if (q) where.name = { contains: q };
  if (type && type !== "all") where.licenseType = type;

  const sort = getParam(sp, "sort") ?? "name";
  const dir: "asc" | "desc" = getParam(sp, "dir") === "desc" ? "desc" : "asc";
  const ORDER: Record<string, Prisma.SoftwareLicenseOrderByWithRelationInput> = {
    name: { name: dir },
    vendor: { vendor: { name: dir } },
    seats: { seats: dir },
    expiresAt: { expiresAt: dir },
  };

  const [total, licenses] = await Promise.all([
    db.softwareLicense.count({ where }),
    db.softwareLicense.findMany({
      where,
      include: {
        vendor: { select: { name: true } },
        owner: { select: { name: true, email: true } },
        _count: { select: { assignments: true } },
      },
      orderBy: [ORDER[sort] ?? ORDER.name],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  return (
    <div className="grid gap-4">
      <ListToolbar filters={filters} searchPlaceholder="Search licenses…" />

      {licenses.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={isFiltered ? "No licenses match" : "No licenses yet"}
          description={
            isFiltered
              ? "Try adjusting your search or filters."
              : "Add a software license to count its seats and assign them to users and assets."
          }
        >
          {isFiltered ? null : createAction}
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortableHead k="name" label="License" sort={sort} dir={dir} />
                <SortableHead k="vendor" label="Vendor" sort={sort} dir={dir} className="hidden md:table-cell" />
                <TableHead>Type</TableHead>
                <SortableHead k="seats" label="Seats" sort={sort} dir={dir} numeric />
                <SortableHead k="expiresAt" label="Expires" sort={sort} dir={dir} className="hidden md:table-cell" />
                <TableHead className="hidden lg:table-cell">Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {licenses.map((l) => (
                <TableRow key={l.id} className="group">
                  <TableCell className="max-w-[320px]">
                    <Link href={`/contracts/licenses/${l.id}`} className="line-clamp-1 font-medium group-hover:text-primary">
                      {l.name}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{l.vendor?.name ?? "—"}</TableCell>
                  <TableCell><StatusBadge map={LICENSE_TYPE_META} value={l.licenseType} dot={false} /></TableCell>
                  <TableCell><LicenseComplianceBadge compliance={licenseCompliance(l.seats, l._count.assignments)} /></TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm tabular-nums">{l.expiresAt ? formatDay(l.expiresAt) : "Never"}</span>
                      <LicenseExpiryBadge expiresAt={l.expiresAt} now={now} />
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {l.owner ? (l.owner.name ?? l.owner.email) : "—"}
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
