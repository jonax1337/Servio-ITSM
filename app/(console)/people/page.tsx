import Link from "next/link";
import { Users } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { anyEmailContains } from "@/lib/user-emails";
import { db } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/session";
import { getParam, getPage, PAGE_SIZE, type SearchParams } from "@/lib/query";
import { PageHeader, PageBody } from "@/components/page-header";
import { ListToolbar, type FilterDef } from "@/components/list-toolbar";
import { SortableHead } from "@/components/sort-header";
import { PaginationBar } from "@/components/pagination-bar";
import { StatusBadge, VipBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { PersonDialog } from "@/components/people/person-dialog";
import { AUTOMATION_EMAIL } from "@/lib/system-user";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ROLE_META, ROLES } from "@/lib/constants";
import { getEnumT, getFormatter, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("people");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const [t, te, f] = await Promise.all([getT("people"), getEnumT(), getFormatter()]);
  const page = getPage(sp);
  const q = getParam(sp, "q");
  const role = getParam(sp, "role");
  const active = getParam(sp, "active");

  const where: Prisma.UserWhereInput = { email: { not: AUTOMATION_EMAIL } };
  if (q) where.OR = [{ name: { contains: q } }, ...anyEmailContains(q)];
  if (role && role !== "all") where.role = role;
  if (active === "true") where.isActive = true;
  else if (active === "false") where.isActive = false;

  const sort = getParam(sp, "sort") ?? "name";
  const dir: "asc" | "desc" = getParam(sp, "dir") === "desc" ? "desc" : "asc";
  const ORDER: Record<string, Prisma.UserOrderByWithRelationInput> = {
    name: { name: dir },
    email: { email: dir },
    department: { department: dir },
    jobTitle: { jobTitle: dir },
    isActive: { isActive: dir },
    lastLoginAt: { lastLoginAt: dir },
  };
  const orderBy = ORDER[sort] ?? ORDER.name;

  const [total, users, groups] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: [orderBy],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.group.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const filters: FilterDef[] = [
    {
      key: "role",
      label: t("filterRole"),
      options: te.options(ROLE_META, ROLES),
    },
    {
      key: "active",
      label: t("filterStatus"),
      options: [
        { value: "true", label: t("active") },
        { value: "false", label: t("inactive") },
      ],
    },
  ];

  return (
    <>
      <PageHeader
        icon={Users}
        title={t("title")}
        description={t("description")}
      >
        {hasRole(me.role, "ADMIN") ? <PersonDialog groups={groups.map((g) => ({ value: g.id, label: g.name }))} /> : null}
      </PageHeader>

      <PageBody className="grid gap-4">
        <ListToolbar filters={filters} searchPlaceholder={t("searchPlaceholder")} />

        {users.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t("noneFound")}
            description={t("noneFoundText")}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead k="name" label={t("colName")} sort={sort} dir={dir} />
                  <SortableHead k="email" label={t("colEmail")} sort={sort} dir={dir} className="hidden lg:table-cell" />
                  <TableHead>{t("colRole")}</TableHead>
                  <SortableHead k="department" label={t("colDepartment")} sort={sort} dir={dir} className="hidden md:table-cell" />
                  <SortableHead k="jobTitle" label={t("colJobTitle")} sort={sort} dir={dir} className="hidden xl:table-cell" />
                  <SortableHead k="isActive" label={t("colActive")} sort={sort} dir={dir} />
                  <SortableHead k="lastLoginAt" label={t("colLastLogin")} sort={sort} dir={dir} numeric className="hidden xl:table-cell text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} className="group">
                    <TableCell>
                      <Link
                        href={`/people/${u.id}`}
                        className="flex items-center gap-3"
                      >
                        <UserAvatar
                          name={u.name}
                          email={u.email}
                          image={u.image}
                        />
                        <span className="line-clamp-1 font-medium group-hover:text-primary">
                          {u.name ?? u.email}
                        </span>
                        {u.isVip ? <VipBadge label={false} /> : null}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {u.email}
                    </TableCell>
                    <TableCell>
                      <StatusBadge map={ROLE_META} value={u.role} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {u.department ?? "—"}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell text-sm text-muted-foreground">
                      {u.jobTitle ?? "—"}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                        <span
                          className={
                            u.isActive
                              ? "size-2 rounded-full bg-emerald-500"
                              : "size-2 rounded-full bg-muted-foreground/40"
                          }
                        />
                        {u.isActive ? t("active") : t("inactive")}
                      </span>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell text-right text-xs text-muted-foreground">
                      {u.lastLoginAt ? f.relative(u.lastLoginAt) : t("never")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <PaginationBar
          pathname="/people"
          searchParams={sp}
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
        />
      </PageBody>
    </>
  );
}
