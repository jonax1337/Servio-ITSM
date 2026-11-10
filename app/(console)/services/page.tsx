import Link from "next/link";
import { LifeBuoy, Radar, User } from "lucide-react";
import { CatalogIcon } from "@/components/catalog/catalog-icon";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSessionUser, hasRole, type Role } from "@/lib/session";
import { getFormOptions } from "@/lib/data/options";
import { getParam, type SearchParams } from "@/lib/query";
import { PageHeader, PageBody } from "@/components/page-header";
import { CreateServiceDialog } from "@/components/services/create-service-dialog";
import { LinkButton } from "@/components/link-button";
import { ListToolbar, type FilterDef } from "@/components/list-toolbar";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import {
  SERVICE_STATUS_META,
  SERVICE_STATUSES,
  CRITICALITY_META,
  CRITICALITIES,
  OPEN_TICKET_STATUSES,
} from "@/lib/constants";
import { getEnumT, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("services");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const options = await getFormOptions();
  const me = await getSessionUser();
  const canManage = !!me && hasRole(me.role as Role, "MANAGER");
  const [t, tc, te] = await Promise.all([getT("services"), getT("common"), getEnumT()]);
  const q = getParam(sp, "q");
  const status = getParam(sp, "status");
  const criticality = getParam(sp, "criticality");

  const where: Prisma.ServiceWhereInput = {};
  if (q) where.OR = [{ name: { contains: q } }, { code: { contains: q } }];
  if (status && status !== "all") where.status = status;
  if (criticality && criticality !== "all") where.criticality = criticality;

  const services = await db.service.findMany({
    where,
    include: {
      owner: true,
      _count: {
        select: { tickets: { where: { status: { in: [...OPEN_TICKET_STATUSES] } } } },
      },
    },
    orderBy: [{ name: "asc" }],
  });

  const filters: FilterDef[] = [
    {
      key: "status",
      label: tc("status"),
      options: te.options(SERVICE_STATUS_META, SERVICE_STATUSES),
    },
    {
      key: "criticality",
      label: t("criticality"),
      options: te.options(CRITICALITY_META, CRITICALITIES),
    },
  ];

  return (
    <>
      <PageHeader
        icon={LifeBuoy}
        title={t("title")}
        description={t("description")}
      >
        <LinkButton href="/services/impact" variant="outline">
          <Radar className="size-4" /> {t("impact.open")}
        </LinkButton>
        {canManage ? <CreateServiceDialog options={options} /> : null}
      </PageHeader>

      <PageBody className="grid gap-4">
        <ListToolbar filters={filters} searchPlaceholder={t("searchPlaceholder")} />

        {services.length === 0 ? (
          <EmptyState
            icon={LifeBuoy}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          >
            {canManage ? <CreateServiceDialog options={options} size="sm" /> : null}
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <Link
                key={s.id}
                href={`/services/${s.id}`}
                className="group flex flex-col gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-lg border bg-muted text-primary">
                    <CatalogIcon name={s.icon} className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-1 font-medium group-hover:text-primary">
                      {s.code ? (
                        <span className="mr-1.5 font-mono text-xs font-normal text-muted-foreground">{s.code}</span>
                      ) : null}
                      {s.name}
                    </h3>
                    {s.description ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {s.description}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge map={SERVICE_STATUS_META} value={s.status} />
                  <StatusBadge
                    map={CRITICALITY_META}
                    value={s.criticality}
                    dot
                  />
                </div>

                <div className="mt-auto flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <User className="size-3.5" />
                    {s.owner ? (s.owner.name ?? s.owner.email) : tc("unassigned")}
                  </span>
                  <span className="tabular-nums">
                    {t("openTickets", { count: s._count.tickets })}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
