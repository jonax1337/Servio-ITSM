import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Timer, Ticket as TicketIcon, ShoppingBag, Radar } from "lucide-react";
import { CatalogIcon } from "@/components/catalog/catalog-icon";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { getEntityApprovals } from "@/lib/data/approvals";
import { getSessionUser, isAgent, hasRole, type Role } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
import { StatusBadge, ToneBadge } from "@/components/status-badge";
import { ServiceProperties } from "@/components/services/service-properties";
import { ServiceEditDialog } from "@/components/services/service-edit-dialog";
import { DeleteServiceButton } from "@/components/services/delete-service-button";
import { ServiceAssets } from "@/components/services/service-assets";
import { ServiceDependencies } from "@/components/services/service-dependencies";
import { ServiceImpactList } from "@/components/services/service-impact-list";
import { serviceImpact } from "@/lib/service-graph";
import { serviceLabel } from "@/lib/service-label";
import { EntityApprovals } from "@/components/approvals/entity-approvals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SERVICE_STATUS_META,
  CRITICALITY_META,
  TICKET_STATUS_META,
  PRIORITY_META,
  OPEN_TICKET_STATUSES,
  ticketRef,
} from "@/lib/constants";
import { getFormatter, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const s = await db.service.findUnique({
    where: { id },
    select: { name: true },
  });
  const t = await getT("services");
  return { title: s ? s.name : t("service") };
}

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [service, options, me] = await Promise.all([
    db.service.findUnique({
      where: { id },
      include: {
        owner: true,
        category: true,
        sla: true,
        assets: {
          orderBy: { createdAt: "asc" },
          select: { asset: { select: { id: true, name: true, status: true } } },
        },
        catalogItems: { orderBy: { name: "asc" }, select: { id: true, name: true, isPublished: true } },
        dependsOn: {
          orderBy: { createdAt: "asc" },
          select: { note: true, toService: { select: { id: true, name: true, code: true, status: true } } },
        },
        usedBy: {
          orderBy: { createdAt: "asc" },
          select: { note: true, fromService: { select: { id: true, name: true, code: true, status: true } } },
        },
        tickets: {
          where: { status: { in: [...OPEN_TICKET_STATUSES] } },
          include: { assignee: true },
          orderBy: { updatedAt: "desc" },
          take: 20,
        },
      },
    }),
    getFormOptions(),
    getSessionUser(),
  ]);
  if (!service) notFound();
  const [t, tc, f] = await Promise.all([getT("services"), getT("common"), getFormatter()]);
  const isAgentUser = !!me && isAgent(me.role as Role);
  const canManage = !!me && hasRole(me.role as Role, "MANAGER");
  const approvals = await getEntityApprovals("SERVICE", service.id);
  const supportingCis = service.assets.map((row) => row.asset);
  const dependsOn = service.dependsOn.map((d) => ({ ...d.toService, note: d.note }));
  const usedBy = service.usedBy.map((d) => ({ ...d.fromService, note: d.note }));
  const [availableAssets, availableServices, impact] = await Promise.all([
    isAgentUser
      ? db.asset.findMany({
          where: { id: { notIn: supportingCis.map((a) => a.id) } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : [],
    isAgentUser
      ? db.service.findMany({
          where: { id: { notIn: [service.id, ...dependsOn.map((d) => d.id)] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, code: true },
        })
      : [],
    serviceImpact(service.id),
  ]);

  return (
    <div data-viewport-pane className="grid gap-0 lg:h-full lg:grid-cols-[1fr_320px] lg:overflow-hidden">
      {/* Main column — scrolls independently from the properties rail */}
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
          <LinkButton href="/services" variant="ghost" size="icon-sm" aria-label={t("backToServices")}>
            <ArrowLeft className="size-4" />
          </LinkButton>
          <span className="text-sm font-medium text-muted-foreground">
            {t("service")}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <StatusBadge map={CRITICALITY_META} value={service.criticality} dot />
            <StatusBadge map={SERVICE_STATUS_META} value={service.status} />
            {isAgentUser ? (
              <>
                <ServiceEditDialog service={service} />
                <DeleteServiceButton serviceId={service.id} serviceName={service.name} />
              </>
            ) : null}
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl border bg-muted text-primary">
              <CatalogIcon name={service.icon} className="size-5.5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                {service.code ? (
                  <span className="mr-2 font-mono text-lg font-medium text-muted-foreground">{service.code}</span>
                ) : null}
                {service.name}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("operationalService")}
                {service.category ? ` · ${service.category.name}` : ""}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border bg-card p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {service.description || (
              <span className="text-muted-foreground">
                {t("noDescription")}
              </span>
            )}
          </div>

          {/* Open tickets */}
          <div className="mt-8">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <TicketIcon className="size-4 text-muted-foreground" />
              {t("openTicketsHeading", { count: service.tickets.length })}
            </h2>
            {service.tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("noOpenTickets")}
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                {service.tickets.map((t) => (
                  <Link
                    key={t.id}
                    href={`/tickets/${t.id}`}
                    className="group flex items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-muted/40"
                  >
                    <span className="w-[76px] shrink-0 font-mono text-xs text-muted-foreground">
                      {ticketRef(t.id, t.prefix)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-primary">
                      {t.title}
                    </span>
                    <StatusBadge
                      map={PRIORITY_META}
                      value={t.priority}
                      dot
                      className="hidden sm:inline-flex"
                    />
                    <StatusBadge map={TICKET_STATUS_META} value={t.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>

          <ServiceAssets
            serviceId={service.id}
            assets={supportingCis}
            options={availableAssets.map((a) => ({ value: a.id, label: a.name }))}
            canEdit={isAgentUser}
          />

          <ServiceDependencies
            serviceId={service.id}
            dependsOn={dependsOn}
            usedBy={usedBy}
            options={availableServices.map((s) => ({ value: s.id, label: serviceLabel(s) }))}
            canEdit={isAgentUser}
          />

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Radar className="size-4 text-muted-foreground" />
                {t("impact.heading", { count: impact.length })}
                <Link
                  href={`/services/impact?service=${service.id}`}
                  className="ml-auto text-xs font-normal text-muted-foreground hover:text-primary"
                >
                  {t("impact.open")}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-sm text-muted-foreground">{t("impact.serviceDescription")}</p>
              <ServiceImpactList rows={impact} empty={t("impact.serviceEmpty")} />
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShoppingBag className="size-4 text-muted-foreground" />
                {t("catalogItems", { count: service.catalogItems.length })}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {service.catalogItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noCatalogItems")}</p>
              ) : (
                service.catalogItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
                    <ToneBadge meta={item.isPublished ? { label: t("published"), tone: "success" } : { label: t("unpublished"), tone: "neutral" }} dot />
                  </div>
                ))
              )}
              {canManage ? (
                <Link href="/catalog" className="text-xs text-muted-foreground hover:text-primary">
                  {t("manageCatalog")}
                </Link>
              ) : null}
            </CardContent>
          </Card>

          {/* Approvals (ad-hoc sign-off) */}
          <EntityApprovals
            entityType="SERVICE"
            entityId={service.id}
            entityTitle={service.name}
            approvals={approvals}
            currentUserId={me?.id ?? ""}
            isAdmin={me?.role === "ADMIN"}
            canManage={canManage}
            canRequest={isAgentUser}
            agents={options.agents}
          />
        </div>
      </div>

      {/* Sidebar */}
      <aside className="p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{tc("properties")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ServiceProperties service={service} options={options} />
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Timer className="size-4 text-muted-foreground" />
              {t("sla")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2.5 text-sm">
            {service.sla ? (
              <>
                <Meta label={t("policy")} value={service.sla.name} />
                <Meta
                  label={t("response")}
                  value={t("minutes", { count: service.sla.responseMins })}
                />
                <Meta
                  label={t("resolve")}
                  value={t("minutes", { count: service.sla.resolveMins })}
                />
              </>
            ) : (
              <p className="text-muted-foreground">{t("noSla")}</p>
            )}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-sm">{tc("details")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2.5 text-sm">
            <Meta label={t("code")} value={service.code ?? "—"} />
            <Meta
              label={tc("owner")}
              value={
                service.owner
                  ? (service.owner.name ?? service.owner.email)
                  : "—"
              }
            />
            <Meta
              label={tc("category")}
              value={service.category ? service.category.name : "—"}
            />
            {service.importRef ? <Meta label={t("importRef")} value={service.importRef} /> : null}
            <Meta label={tc("created")} value={f.date(service.createdAt)} />
            <Meta label={tc("updated")} value={f.date(service.updatedAt)} />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  );
}
