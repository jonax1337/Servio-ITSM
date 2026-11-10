import type { Metadata } from "next";
import { ArrowLeft, Radar } from "lucide-react";
import { db } from "@/lib/db";
import { getParam, type SearchParams } from "@/lib/query";
import { PageHeader, PageBody } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { ImpactTargetPicker } from "@/components/services/impact-target-picker";
import { ServiceImpactList } from "@/components/services/service-impact-list";
import { searchAffectedCis } from "@/lib/actions/changes";
import { serviceImpact, servicesAffectedByAssets } from "@/lib/service-graph";
import { serviceLabel } from "@/lib/service-label";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("services");
  return { title: t("impactPage.title") };
}
export const dynamic = "force-dynamic";

/**
 * Impact analysis: which services go down, directly or through dependencies,
 * when a service or a configuration item fails (lib/service-graph.ts).
 */
export default async function ServiceImpactPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getT("services");
  const serviceId = getParam(sp, "service") || null;
  const assetId = serviceId ? null : getParam(sp, "asset") || null;

  const [services, service, asset] = await Promise.all([
    db.service.findMany({ select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
    serviceId ? db.service.findUnique({ where: { id: serviceId }, select: { id: true, name: true, code: true } }) : null,
    assetId ? db.asset.findUnique({ where: { id: assetId }, select: { id: true, name: true } }) : null,
  ]);
  const rows = service ? await serviceImpact(service.id) : asset ? await servicesAffectedByAssets([asset.id]) : null;

  return (
    <>
      <PageHeader icon={Radar} title={t("impactPage.title")} description={t("impactPage.description")}>
        <LinkButton href="/services" variant="outline">
          <ArrowLeft className="size-4" /> {t("backToServices")}
        </LinkButton>
      </PageHeader>
      <PageBody className="grid gap-6">
        <div className="rounded-xl border bg-card p-4">
          <ImpactTargetPicker
            services={services.map((s) => ({ value: s.id, label: serviceLabel(s) }))}
            searchAssets={searchAffectedCis}
            serviceId={service?.id ?? null}
            assetId={asset?.id ?? null}
          />
        </div>

        {rows === null ? (
          <p className="text-sm text-muted-foreground">{t("impactPage.pickPrompt")}</p>
        ) : (
          <section>
            <h2 className="mb-1 text-sm font-semibold">
              {service
                ? t("impactPage.ifServiceFails", { name: serviceLabel(service), count: rows.length })
                : t("impactPage.ifAssetFails", { name: asset!.name, count: rows.length })}
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {service ? t("impact.serviceDescription") : t("impact.assetDescription")}
            </p>
            <ServiceImpactList rows={rows} empty={service ? t("impact.serviceEmpty") : t("impact.assetEmpty")} />
          </section>
        )}
      </PageBody>
    </>
  );
}
