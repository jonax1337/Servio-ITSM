import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Clock } from "lucide-react";
import { db } from "@/lib/db";
import { getSessionUser, requireUser } from "@/lib/session";
import { canSeeCatalogItem } from "@/lib/catalog-visibility";
import { isPortalCatalogItem, portalCatalogItemName } from "@/lib/portal-access";
import { parseFormSchema } from "@/lib/service-forms";
import { CatalogIcon } from "@/components/catalog/catalog-icon";
import { LinkButton } from "@/components/link-button";
import { getMaxUploadMb } from "@/lib/settings";
import { Card, CardContent } from "@/components/ui/card";
import { ServiceRequestForm } from "@/components/portal/service-request-form";
import { getT } from "@/lib/i18n/server";
import { assetLabel, listOwnAssets } from "@/lib/catalog-form-links";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}): Promise<Metadata> {
  const { serviceId } = await params;
  // Same rule as the page: the name of an unpublished or group-restricted item must not leak.
  const me = await getSessionUser();
  const name = await portalCatalogItemName(serviceId, me?.id ?? null);
  const t = await getT("portal");
  return { title: name ? t("requestTitle", { name }) : t("request") };
}

export default async function CatalogRequestPage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const me = await requireUser();
  const { serviceId } = await params;
  const item = await db.catalogItem.findUnique({ where: { id: serviceId } });
  // 404 (not 403) for an item restricted to other groups: its existence is not revealed.
  if (!item || !isPortalCatalogItem(item) || !(await canSeeCatalogItem(item.id, me.id))) notFound();

  const maxUploadMb = await getMaxUploadMb();
  const t = await getT("portal");
  const fields = parseFormSchema(item.formSchema);
  const ownAssets = fields.some((f) => f.type === "asset")
    ? (await listOwnAssets(me.id)).map((a) => ({ value: a.id, label: assetLabel(a) }))
    : [];

  return (
    <div className="mx-auto max-w-2xl">
      <LinkButton href="/portal/catalog" variant="ghost" size="sm" className="mb-4 -ml-2">
        <ArrowLeft className="size-4" /> {t("backToCatalog")}
      </LinkButton>

      <div className="mb-6 flex items-start gap-3.5">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <CatalogIcon name={item.icon} className="size-6" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{item.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{item.description ?? item.shortDescription}</p>
          {item.estimatedDays != null ? (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3.5" /> {t("deliveredIn", { count: item.estimatedDays })}
            </p>
          ) : null}
        </div>
      </div>

      <Card>
        <CardContent>
          <ServiceRequestForm
            serviceId={item.id}
            fields={fields}
            requiresApproval={item.requiresApproval}
            ownAssets={ownAssets}
            maxMb={maxUploadMb}
          />
        </CardContent>
      </Card>
    </div>
  );
}
